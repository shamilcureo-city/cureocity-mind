import { describe, expect, it } from 'vitest';
import { MockGeminiReasoningBackend } from '../../backends/mock-gemini.backend';
import { REASONING_FIXTURES } from './fixtures';
import { gateDifferential } from './scorer';
import { runReasoningEval } from './runner';

describe('reasoning eval harness', () => {
  it('has 12 fixtures spanning cardio/endo/gp and en/hi/ml', () => {
    expect(REASONING_FIXTURES).toHaveLength(12);
    const domains = new Set(REASONING_FIXTURES.map((f) => f.domain));
    const langs = new Set(REASONING_FIXTURES.map((f) => f.language));
    expect([...domains].sort()).toEqual(['cardio', 'endo', 'gp']);
    expect([...langs].sort()).toEqual(['en', 'hi', 'ml']);
  });

  it('runs the whole set against the mock backend and produces a report', async () => {
    const report = await runReasoningEval(new MockGeminiReasoningBackend());
    expect(report.total).toBe(12);
    // The keyword-routed mock should recover the primary dx for every case.
    expect(report.primaryHits).toBe(12);
    expect(report.meanTop3Recall).toBeGreaterThan(0.8);
    // DS3 — must-ask questions recovered ≥80% (the ask-next acceptance).
    expect(report.meanAskRecall).toBeGreaterThanOrEqual(0.8);
    // Nothing uncited ever renders (post-gate invariant).
    expect(report.allRenderedCited).toBe(true);
    expect(report.totalDroppedDx).toBe(0);
  });

  it('the citation gate drops a candidate that cites no real finding', () => {
    const { kept, dropped } = gateDifferential(
      [
        {
          id: 'd1',
          label: 'real',
          likelihood: 'high',
          trend: 'new',
          urgent: false,
          evidenceFor: ['f1'],
          evidenceAgainst: [],
        },
        {
          id: 'd2',
          label: 'ghost',
          likelihood: 'low',
          trend: 'new',
          urgent: false,
          evidenceFor: ['f999'],
          evidenceAgainst: [],
        },
      ],
      [{ id: 'f1', kind: 'symptom', label: 'x', utteranceIds: ['u1'], polarity: 'present' }],
    );
    expect(kept.map((d) => d.id)).toEqual(['d1']);
    expect(dropped).toBe(1);
  });
});
