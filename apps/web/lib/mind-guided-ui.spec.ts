import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TherapyReasoningV1Schema, TherapyScriptV1Schema } from '@cureocity/contracts';
import { MindTherapyGuide } from '../components/app/MindTherapyGuide';
import { TherapyCopilotRail } from '../components/app/TherapyCopilotRail';
import { Sidebar } from '../components/app/Sidebar';
import { MobileNav } from '../components/app/MobileNav';
import { liveCopilotVisibleCounts, mindGuideSteps, reviewedGuideCount } from './mind-guidance';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/clinic' }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) =>
    React.createElement('a', props, children),
}));

// The app delegates JSX transformation to Next. Vitest's node-only config uses
// classic JSX for the few presentational components rendered in this test.
beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const script = TherapyScriptV1Schema.parse({
  version: 'V1',
  therapyName: 'Synthetic clinician-reviewed guide',
  openingScript: 'SYNTHETIC opening conversation',
  mainExercise: {
    steps: [
      {
        id: 'opening',
        purpose: 'First exercise',
        therapistSays: 'SYNTHETIC first exercise',
        listenFor: 'SYNTHETIC first response',
        branches: [{ ifClientSays: 'SYNTHETIC hesitation', thenDo: 'SYNTHETIC adaptation' }],
      },
      {
        id: 'opening',
        purpose: 'Second exercise',
        therapistSays: 'SYNTHETIC second exercise',
        listenFor: 'SYNTHETIC second response',
        branches: [],
      },
    ],
  },
  closingScript: 'SYNTHETIC closing reflection',
  homework: {
    description: 'SYNTHETIC optional between-session practice',
    deliveryNotes: 'SYNTHETIC discuss preference first',
  },
  riskWatchpoints: ['SYNTHETIC watchpoint one', 'SYNTHETIC watchpoint two'],
  adaptationCues: ['SYNTHETIC adapt to current presentation'],
  estimatedDurationMin: 40,
});

const reasoning = TherapyReasoningV1Schema.parse({
  riskWatch: [
    ...(['low', 'medium', 'high', 'critical'] as const).map((severity) => ({
      id: `risk-${severity}`,
      label: `SYNTHETIC ${severity} concern`,
      why: `SYNTHETIC ${severity} evidence`,
      severity,
      source: 'LIVE',
    })),
    {
      id: 'carried-risk',
      label: 'SYNTHETIC carried concern',
      why: 'SYNTHETIC unresolved previous concern',
      severity: 'high',
      source: 'CARRIED_RISK',
    },
  ],
  askNext: ['CARRIED', 'LIVE'].flatMap((source) =>
    [1, 2, 3].map((index) => ({
      id: `${source}-${index}`,
      question: `SYNTHETIC ${source} ordinary question ${index}`,
      why: `SYNTHETIC ${source} rationale ${index}`,
      source,
    })),
  ),
  threads: [1, 2, 3].map((index) => ({
    id: `thread-${index}`,
    topic: `SYNTHETIC ordinary topic ${index}`,
    note: `SYNTHETIC ordinary thread note ${index}`,
  })),
});

describe('Mind guide identity and truthful review progress', () => {
  it('preserves the entire draft and gives repeated model step ids distinct UI identities', () => {
    const steps = mindGuideSteps(script);
    expect(steps.map((step) => step.id)).toEqual([
      'opening',
      'exercise:0:opening',
      'exercise:1:opening',
      'closing',
      'between_sessions',
    ]);
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
    expect(steps.map((step) => step.text)).toEqual([
      script.openingScript,
      ...script.mainExercise.steps.map((step) => step.therapistSays),
      script.closingScript,
      script.homework.description,
    ]);
    expect(steps[1]?.branches).toEqual(script.mainExercise.steps[0]?.branches);
    expect(steps.at(-1)?.listenFor).toBe(script.homework.deliveryNotes);
  });

  it('counts only distinct review markers belonging to the current guide', () => {
    const steps = mindGuideSteps(script);
    expect(reviewedGuideCount(steps, new Set())).toBe(0);
    expect(reviewedGuideCount(steps, new Set(['opening', 'opening', 'stale-id']))).toBe(1);
    expect(reviewedGuideCount(steps, new Set(steps.map((step) => step.id)))).toBe(5);
    expect(reviewedGuideCount([], new Set(['opening']))).toBe(0);
  });

  it('limits ordinary guided prompts to one per category and hides them all in Quiet', () => {
    expect(liveCopilotVisibleCounts('guided', 3, 7, 2)).toEqual({
      planned: 1,
      live: 1,
      threads: 1,
    });
    expect(liveCopilotVisibleCounts('guided', 0, 1, 0)).toEqual({
      planned: 0,
      live: 1,
      threads: 0,
    });
    expect(liveCopilotVisibleCounts('quiet', 3, 7, 2)).toEqual({
      planned: 0,
      live: 0,
      threads: 0,
    });
  });
});

describe('Mind Quiet mode clinical boundary', () => {
  it('renders every live severity and carried risk outside collapsed disclosures', () => {
    const onResolve = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(TherapyCopilotRail, { reasoning, mode: 'quiet', onResolve }),
    );
    for (const risk of reasoning.riskWatch) {
      expect(html).toContain(risk.label);
      expect(html).toContain(risk.why);
    }
    expect(html.match(/Assessed ✓/g)).toHaveLength(reasoning.riskWatch.length);
    expect(html).not.toContain('<details');
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('does not render ordinary questions, their rationales, or unexplored threads in Quiet', () => {
    const html = renderToStaticMarkup(
      React.createElement(TherapyCopilotRail, {
        reasoning,
        mode: 'quiet',
        onResolve: vi.fn(),
      }),
    );
    for (const question of reasoning.askNext) {
      expect(html).not.toContain(question.question);
      expect(html).not.toContain(question.why);
    }
    for (const thread of reasoning.threads) {
      expect(html).not.toContain(thread.topic);
      expect(html).not.toContain(thread.note);
    }
    expect(html).toContain('Safety concerns remain visible');
  });

  it('retains secondary guidance in closed disclosures and never puts risk inside one', () => {
    const html = renderToStaticMarkup(
      React.createElement(TherapyCopilotRail, { reasoning, onResolve: vi.fn() }),
    );
    const collapsed = [...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(
      ([details]) => details,
    );
    expect(collapsed).toHaveLength(3);
    expect(html).not.toMatch(/<details\b[^>]*\bopen(?:[\s=>])/);
    for (const risk of reasoning.riskWatch) {
      expect(html).toContain(risk.label);
      expect(collapsed.join('')).not.toContain(risk.label);
    }
    for (const question of reasoning.askNext) expect(html).toContain(question.question);
    for (const thread of reasoning.threads) expect(html).toContain(thread.topic);
    expect(collapsed[0]).toContain('SYNTHETIC CARRIED ordinary question 2');
    expect(collapsed[0]).not.toContain('SYNTHETIC CARRIED ordinary question 1');
    expect(collapsed[1]).toContain('SYNTHETIC LIVE ordinary question 2');
    expect(collapsed[1]).not.toContain('SYNTHETIC LIVE ordinary question 1');
    expect(collapsed[2]).toContain('SYNTHETIC ordinary topic 2');
    expect(collapsed[2]).not.toContain('SYNTHETIC ordinary topic 1');
  });
});

describe('Mind guide starts with a clinician review gate', () => {
  it('starts with the full draft and all watchpoints, without guided execution controls', () => {
    const html = renderToStaticMarkup(React.createElement(MindTherapyGuide, { script }));
    expect(html).toContain('AI-drafted guidance');
    expect(html).toContain('I have reviewed this draft for suitability');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*>/);
    expect(html).not.toMatch(/<input[^>]*\bchecked(?:[\s=>])/);
    for (const step of mindGuideSteps(script)) expect(html).toContain(step.text);
    for (const risk of script.riskWatchpoints) expect(html).toContain(risk);
    expect(html.indexOf('Guide watchpoints')).toBeLessThan(html.indexOf(script.openingScript));
    expect(html).not.toContain('aria-label="Guide sections"');
    expect(html).not.toContain('Mark section reviewed');
    expect(html).not.toContain('Next section');
    expect(html).not.toContain('Open step-by-step guide');
  });

  it('does not claim reviewed, delivered, assigned, or shared work on initial render', () => {
    const html = renderToStaticMarkup(React.createElement(MindTherapyGuide, { script }));
    expect(html).toContain('0 of 5 guide sections reviewed');
    expect(html).not.toContain('Your guide review is complete');
    expect(html).toContain('They do not save a clinical event, advance therapy, assign homework');
    expect(html).toContain('or share anything with the client');
    expect(html).not.toContain('<form');
  });
});

describe('Shared navigation keeps the Doctor boundary', () => {
  it('keeps the doctor desktop destinations and POST-only sign-out without Mind branding', () => {
    const html = renderToStaticMarkup(React.createElement(Sidebar, { vertical: 'DOCTOR' }));
    for (const href of ['/app/clinic', '/app/patients', '/app/insights', '/app/learn']) {
      expect(html).toContain(`href="${href}"`);
    }
    for (const marker of [
      'mind-sidebar',
      'mind-brand',
      'mind-nav-note',
      'Practice &amp; resources',
    ]) {
      expect(html).not.toContain(marker);
    }
    expect(html).not.toContain('href="/app/today"');
    expect(html).not.toContain('href="/app/encounters/new"');
    const signOutForm = html.match(/<form\b[^>]*action="\/api\/v1\/auth\/signout"[^>]*>/)?.[0];
    expect(signOutForm).toContain('method="POST"');
    expect(html).not.toContain('href="/api/v1/auth/signout"');
  });

  it('applies the Mind brand and secondary resources only to therapist navigation', () => {
    const html = renderToStaticMarkup(React.createElement(Sidebar, { vertical: 'THERAPIST' }));
    expect(html).toContain('mind-sidebar');
    expect(html).toContain('Cureocity Mind — Today');
    expect(html).toContain('Practice &amp; resources');
    for (const href of ['/app/today', '/app/encounters/new', '/app/clients', '/app/search']) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).not.toContain('href="/app/clinic"');
    expect(html).not.toContain('href="/app/patients"');
  });

  it('keeps doctor mobile navigation free of Mind styling and therapist-only destinations', () => {
    const html = renderToStaticMarkup(React.createElement(MobileNav, { vertical: 'DOCTOR' }));
    for (const href of ['/app/clinic', '/app/patients', '/app/insights', '/app/settings']) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).not.toContain('mind-mobile-nav');
    expect(html).not.toContain('href="/app/encounters/new"');
    expect(html).not.toContain('More');
  });
});
