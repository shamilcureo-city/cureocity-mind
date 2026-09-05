import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TherapyReasoningV1Schema, type TherapyReasoningV1 } from '@cureocity/contracts';
import { TherapyCopilotRail } from '../components/app/TherapyCopilotRail';
import {
  disclosedCopilotSuggestions,
  markCopilotSuggestionShown,
} from './therapy-copilot-disclosure';

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const reasoning = TherapyReasoningV1Schema.parse({
  riskWatch: [
    ...(['low', 'medium', 'high', 'critical'] as const).map((severity) => ({
      id: `risk-${severity}`,
      label: `Synthetic ${severity} concern`,
      why: 'Synthetic evidence',
      severity,
      source: 'LIVE',
    })),
    {
      id: 'carried-risk',
      label: 'Carried concern',
      why: 'Prior assessment',
      severity: 'high',
      source: 'CARRIED_RISK',
    },
  ],
  askNext: ['CARRIED', 'LIVE'].flatMap((source) =>
    [1, 2, 3].map((index) => ({
      id: `${source}-${index}`,
      question: `Synthetic ${source} question ${index}`,
      why: 'Synthetic rationale',
      source,
    })),
  ),
  threads: [1, 2, 3].map((index) => ({
    id: `thread-${index}`,
    topic: `Synthetic topic ${index}`,
    note: 'Synthetic thread',
  })),
});
const riskIds = ['risk-low', 'risk-medium', 'risk-high', 'risk-critical'];
const collapsed = { live: false, threads: false };
const expanded = { live: true, threads: true };
const ids = (items: { id: string }[]) => items.map((item) => item.id);

function observer() {
  const tracker = { sessionId: 'session-1', ids: new Set<string>() };
  return (
    data: TherapyReasoningV1,
    mode: 'quiet' | 'guided' = 'guided',
    open = collapsed,
    sessionId = 'session-1',
  ) =>
    disclosedCopilotSuggestions(data, mode, open).filter((item) =>
      markCopilotSuggestionShown(tracker, sessionId, item.id),
    );
}

describe('truthful copilot card disclosure', () => {
  it('reports every visible live risk and only the first ordinary card per category in Guided', () => {
    const shown = disclosedCopilotSuggestions(reasoning, 'guided', collapsed);
    expect(ids(shown)).toEqual([...riskIds, 'LIVE-1', 'thread-1']);
    expect(shown.find((item) => item.id === 'LIVE-1')).toEqual({
      id: 'LIVE-1',
      kind: 'ASK_NEXT',
      label: 'Synthetic LIVE question 1',
    });
    expect(shown.find((item) => item.id === 'risk-high')?.kind).toBe('RED_FLAG');
    expect(shown.find((item) => item.id === 'thread-1')?.kind).toBe('GAP');
  });

  it.each([collapsed, expanded, { live: true, threads: false }, { live: false, threads: true }])(
    'never reports hidden ordinary cards in Quiet even with expansion flags %j',
    (open) => {
      expect(ids(disclosedCopilotSuggestions(reasoning, 'quiet', open))).toEqual(riskIds);
    },
  );

  it.each([
    [{ live: true, threads: false }, ['LIVE-1', 'LIVE-2', 'LIVE-3', 'thread-1']],
    [{ live: false, threads: true }, ['LIVE-1', 'thread-1', 'thread-2', 'thread-3']],
    [expanded, ['LIVE-1', 'LIVE-2', 'LIVE-3', 'thread-1', 'thread-2', 'thread-3']],
  ] as const)('reports extra cards only in their own expanded disclosure %j', (open, expected) => {
    expect(ids(disclosedCopilotSuggestions(reasoning, 'guided', open))).toEqual([
      ...riskIds,
      ...expected,
    ]);
  });

  it('does not count model receipt of hidden cards, but counts them after expansion', () => {
    const observe = observer();
    observe(reasoning);
    const updated = TherapyReasoningV1Schema.parse({
      ...reasoning,
      askNext: [
        ...reasoning.askNext,
        { id: 'LIVE-new', source: 'LIVE' as const, question: 'New question', why: 'New reason' },
      ],
    });
    expect(observe(updated)).toEqual([]);
    expect(ids(observe(updated, 'guided', { live: true, threads: false }))).toEqual([
      'LIVE-2',
      'LIVE-3',
      'LIVE-new',
    ]);
  });

  it('reports new model cards arriving while native disclosures are already open', () => {
    const observe = observer();
    observe(reasoning, 'guided', expanded);
    const updated = TherapyReasoningV1Schema.parse({
      ...reasoning,
      askNext: [
        ...reasoning.askNext,
        { id: 'LIVE-new', source: 'LIVE' as const, question: 'New question', why: 'New reason' },
      ],
      threads: [
        ...reasoning.threads,
        { id: 'thread-new', topic: 'New topic', note: 'New context', mentions: 1 },
      ],
    });
    expect(ids(observe(updated, 'guided', expanded))).toEqual(['LIVE-new', 'thread-new']);
    expect(observe(updated, 'guided', expanded)).toEqual([]);
  });

  it('reports a newly exposed first card after resolution/removal, not the removed card', () => {
    const observe = observer();
    observe(reasoning);
    const resolved = {
      ...reasoning,
      askNext: reasoning.askNext.filter((item) => item.id !== 'LIVE-1'),
      threads: reasoning.threads.filter((item) => item.id !== 'thread-1'),
    };
    expect(ids(observe(resolved))).toEqual(['LIVE-2', 'thread-2']);
  });

  it('does not duplicate shown events on reopening, rerendering, or reordering', () => {
    const observe = observer();
    observe(reasoning, 'guided', expanded);
    expect(observe(reasoning)).toEqual([]);
    expect(observe(reasoning, 'guided', expanded)).toEqual([]);
    expect(
      observe({ ...reasoning, askNext: [...reasoning.askNext].reverse() }, 'guided', expanded),
    ).toEqual([]);
  });

  it('treats remounted details as collapsed after removal instead of retaining expansion state', () => {
    const observe = observer();
    observe(reasoning, 'guided', expanded);
    observe({ ...reasoning, askNext: [], threads: [] });
    const replacement = TherapyReasoningV1Schema.parse({
      askNext: [1, 2].map((index) => ({
        id: `replacement-${index}`,
        source: 'LIVE',
        question: `New ${index}`,
        why: 'New',
      })),
    });
    expect(ids(observe(replacement, 'guided', collapsed))).toEqual(['replacement-1']);
    expect(ids(observe(replacement, 'guided', { live: true, threads: false }))).toEqual([
      'replacement-2',
    ]);
  });

  it('counts previously hidden ordinary cards when switching from Quiet to Guided', () => {
    const observe = observer();
    expect(ids(observe(reasoning, 'quiet'))).toEqual(riskIds);
    expect(ids(observe(reasoning))).toEqual(['LIVE-1', 'thread-1']);
    expect(observe(reasoning, 'quiet')).toEqual([]);
  });

  it('deduplicates within one session but resets if the same component receives another session', () => {
    const observe = observer();
    const first = observe(reasoning);
    expect(observe(reasoning)).toEqual([]);
    expect(observe(reasoning, 'guided', collapsed, 'session-2')).toEqual(first);
    expect(observe(reasoning, 'guided', collapsed, 'session-2')).toEqual([]);
  });

  it('returns nothing for an empty rail or deterministic carried-only content', () => {
    expect(
      disclosedCopilotSuggestions(TherapyReasoningV1Schema.parse({}), 'guided', expanded),
    ).toEqual([]);
    const carried = {
      ...reasoning,
      riskWatch: reasoning.riskWatch.filter((item) => item.source === 'CARRIED_RISK'),
      askNext: reasoning.askNext.filter((item) => item.source === 'CARRIED'),
      threads: [],
    };
    expect(disclosedCopilotSuggestions(carried, 'guided', expanded)).toEqual([]);
  });

  it('keeps preview/server rendering pure even when a shown callback is provided', () => {
    const onShown = vi.fn();
    const onResolve = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(TherapyCopilotRail, { reasoning, onShown, onResolve }),
    );
    expect(html).toContain('Synthetic critical concern');
    expect(html).not.toMatch(/<details\b[^>]*\bopen(?:[\s=>])/);
    expect(onShown).not.toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });
});
