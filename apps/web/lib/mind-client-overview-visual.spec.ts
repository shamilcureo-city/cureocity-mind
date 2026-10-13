import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MindClientOverview,
  type MindClientOverviewProps,
  type MindOverviewSession,
} from '../components/app/MindClientOverview';

const props: MindClientOverviewProps = {
  clientId: 'fictional-client',
  name: 'Fictional client',
  age: null,
  createdAt: new Date('2026-09-07T04:30:00Z'),
  isDemo: false,
  presentingConcerns: null,
  sessions: [],
  activeHomeworkCount: 0,
  defaultCapture: 'LIVE',
  now: new Date('2026-10-12T03:00:00Z'),
  journey: {
    clientId: 'fictional-client',
    stage: 'INTAKE',
    sessionsCompleted: 0,
    lastSessionAt: null,
    workingDiagnosis: null,
    activePlan: null,
    instrumentChanges: [],
    nextBestAction: null,
    closedEpisode: null,
  },
};

function session(
  id: string,
  status: string,
  at: string,
  extra: Partial<MindOverviewSession> = {},
): MindOverviewSession {
  return {
    id,
    status,
    scheduledAt: new Date(at),
    modality: 'SUPPORTIVE',
    therapyNote: null,
    noteDraft: null,
    ...extra,
  };
}
const render = (overrides: Partial<MindClientOverviewProps> = {}) =>
  renderToStaticMarkup(createElement(MindClientOverview, { ...props, ...overrides }));

describe('Mind client visual overview retains authoritative care and session state', () => {
  beforeEach(() => vi.stubGlobal('React', React));
  afterEach(() => vi.unstubAllGlobals());

  it('renders honest empty states without fabricated goals, improvement or dates', () => {
    const html = render();
    expect(html).toContain('No confirmed care plan yet');
    expect(html).toContain('not yet two recorded responses to compare');
    expect(html).toContain('No next appointment booked');
    expect(html).toContain('No completed session yet');
    expect(html).toContain('0 completed sessions; 0 total appointments');
    expect(html).toContain('href="/app?record=fictional-client&amp;capture=LIVE"');
    expect(html).not.toContain('reliable improvement');
    expect(html).not.toContain('Session 6');
  });

  it('keeps exact dated observations, visible score labels and clinician ownership', () => {
    const html = render({
      journey: {
        ...props.journey,
        activePlan: {
          id: 'plan-1',
          version: 2,
          modality: 'CBT',
          confirmedAt: '2026-09-28T05:00:00Z',
          goalsAchieved: 1,
          goalsTotal: 2,
          goals: [
            {
              index: 0,
              description: 'Client-defined evening routine',
              measure: 'Review at the next visit',
              status: 'IN_PROGRESS',
            },
            {
              index: 1,
              description: 'A second recorded goal',
              measure: 'Clinician review',
              status: 'ACHIEVED',
            },
          ],
        },
        instrumentChanges: [
          {
            instrumentKey: 'GAD7',
            baselineScore: 13,
            latestScore: 9,
            baselineAt: '2026-09-07T04:30:00Z',
            latestAt: '2026-10-05T04:30:00Z',
            delta: -4,
            percentChange: -30.76,
            verdict: 'reliable_improvement',
            isResponse: false,
            isRemission: false,
            baselineSeverityKey: 'moderate',
            latestSeverityKey: 'mild',
            administrationCount: 2,
          },
        ],
      },
    });
    expect(html).toContain('Client-defined evening routine');
    expect(html).toContain('Plan confirmed 28 Sept 2026');
    expect(html).toContain('dateTime="2026-09-07T04:30:00Z"');
    expect(html).toContain('dateTime="2026-10-05T04:30:00Z"');
    expect(html).toContain('13/21');
    expect(html).toContain('9/21');
    expect(html).toContain('Recorded as achieved');
    expect(html).toContain('not a measure of recovery');
    expect(html).toContain('do not establish a diagnosis or confirm recovery');
    expect(html).toContain('/journey#measure-gad7');
    expect(html).not.toContain('30.76');
  });

  it('reuses the next booked appointment instead of dropping its identity', () => {
    const html = render({
      sessions: [session('booked-visit', 'SCHEDULED', '2026-10-12T04:30:00Z')],
    });
    expect(html).toContain(
      'href="/app?record=fictional-client&amp;session=booked-visit&amp;capture=LIVE"',
    );
    expect(html).toContain('Prepare session');
    expect(html).toContain('0 completed sessions; 1 total appointments');
  });

  it('orders milestones by their recorded dates when a plan is confirmed after the last session', () => {
    const html = render({
      sessions: [session('completed', 'COMPLETED', '2026-10-05T04:30:00Z')],
      journey: {
        ...props.journey,
        activePlan: {
          id: 'later-plan',
          version: 1,
          modality: 'SUPPORTIVE',
          confirmedAt: '2026-10-09T04:30:00Z',
          goalsAchieved: 0,
          goalsTotal: 1,
          goals: [
            {
              index: 0,
              description: 'A goal not begun',
              measure: 'Discuss together',
              status: 'NOT_STARTED',
            },
          ],
        },
      },
    });
    const timeline = html.slice(
      html.indexOf('aria-label="Recorded care milestones"'),
      html.indexOf('</ol>'),
    );
    expect(timeline.indexOf('Client record opened')).toBeLessThan(
      timeline.indexOf('Last completed session'),
    );
    expect(timeline.indexOf('Last completed session')).toBeLessThan(
      timeline.indexOf('Current plan confirmed'),
    );
    expect(html).toContain('Not started');
  });

  it('prioritizes the current live session and does not claim the microphone is on', () => {
    const html = render({
      sessions: [
        session('next', 'SCHEDULED', '2026-10-13T04:30:00Z'),
        session('current', 'IN_PROGRESS', '2026-10-12T02:30:00Z', { captureMode: 'LIVE' }),
      ],
    });
    expect(html).toContain('href="/app/sessions/current/live"');
    expect(html).toContain('Continue session');
    expect(html).toContain('does not mean a microphone is recording now');
    expect(html).not.toContain('href="/app?record=fictional-client&amp;session=next');
  });

  it('preserves manual and batch recovery destinations', () => {
    const manual = render({
      sessions: [
        session('manual', 'IN_PROGRESS', '2026-10-12T02:30:00Z', {
          mindDocumentationMode: 'MANUAL',
        }),
      ],
    });
    expect(manual).toContain('href="/app/sessions/manual"');
    expect(manual).toContain('Continue note');
    expect(manual).not.toContain('/manual/live');
    const batch = render({
      sessions: [
        session('batch', 'IN_PROGRESS', '2026-10-12T02:30:00Z', { captureMode: 'DICTATE' }),
      ],
    });
    expect(batch).toContain(
      'href="/app?record=fictional-client&amp;session=batch&amp;capture=BATCH"',
    );
  });

  it('distinguishes signed, reopened and failed notes in recent records', () => {
    const html = render({
      sessions: [
        session('signed', 'COMPLETED', '2026-10-11T04:30:00Z', {
          therapyNote: { id: 'note1', locked: true, signedAt: '2026-10-11T05:30:00Z' },
        }),
        session('reopened', 'COMPLETED', '2026-10-10T04:30:00Z', {
          therapyNote: { id: 'note2', locked: false, signedAt: '2026-10-10T05:30:00Z' },
        }),
        session('failed', 'COMPLETED', '2026-10-09T04:30:00Z', { noteDraft: { status: 'FAILED' } }),
      ],
    });
    expect(html).toContain('Signed note');
    expect(html).toContain('Reopened — needs signature');
    expect(html).toContain('Note generation failed');
    expect(html).toContain('/app/sessions/signed?tab=note');
    expect(html).toContain('3 completed sessions; 3 total appointments');
  });

  it('keeps safety before the overview and existing preparation/admin content available', () => {
    const html = render({
      safetyBanner: createElement('div', { role: 'alert' }, 'Existing safety concern'),
      scheduleAction: createElement('button', null, 'Schedule follow-up'),
      clientSettings: createElement(
        'details',
        null,
        createElement('summary', null, 'Client settings'),
      ),
      contactDetails: createElement(
        'details',
        null,
        createElement('summary', null, 'Contact details'),
      ),
      preparationPanel: createElement('div', null, 'Existing preparation panel'),
      children: createElement('div', null, 'Care record, work history and data rights'),
    });
    expect(html.indexOf('Existing safety concern')).toBeLessThan(html.indexOf('<header'));
    expect(html).toContain('Schedule follow-up');
    expect(html).toContain('Client settings');
    expect(html).toContain('Contact details');
    expect(html).toContain('id="prepare"');
    expect(html).toContain('Existing preparation panel');
    expect(html).toContain('Care record, work history and data rights');
  });

  it('keeps example and unavailable-name markers visible and escapes source text', () => {
    const html = render({
      name: '',
      isDemo: true,
      presentingConcerns: '<script>unsafe()</script>',
    });
    expect(html).toContain('Name unavailable');
    expect(html).toContain('Contact support to restore name');
    expect(html).toContain('fabricated example');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe()');
  });
});
