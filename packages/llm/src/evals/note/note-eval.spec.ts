import { describe, expect, it } from 'vitest';
import { MockGeminiPass2Backend } from '../../backends/mock-gemini.backend';
import { NOTE_FIXTURES } from './fixtures';
import { runNoteEval, passesGate } from './runner';
import { scoreFixture } from './scorer';
import type { Pass2Output } from '../../types';

describe('note eval harness', () => {
  it('has fixtures spanning risk levels and languages', () => {
    expect(NOTE_FIXTURES.length).toBeGreaterThanOrEqual(3);
    const risks = new Set(NOTE_FIXTURES.map((f) => f.expectRisk));
    // At least one crisis fixture (the safety metric needs something to catch).
    expect(risks.has('high')).toBe(true);
    const langs = new Set(NOTE_FIXTURES.map((f) => f.language));
    expect(langs.size).toBeGreaterThanOrEqual(2);
  });

  it('runs the whole set against the mock backend and produces a report', async () => {
    const report = await runNoteEval(new MockGeminiPass2Backend());
    expect(report.total).toBe(NOTE_FIXTURES.length);
    // The mock always returns a complete, well-formed SOAP note.
    expect(report.sectionsCompleteAll).toBe(true);
    // Every score is a finite fraction.
    for (const s of report.scores) {
      expect(s.factRecall).toBeGreaterThanOrEqual(0);
      expect(s.factRecall).toBeLessThanOrEqual(1);
    }
  });

  it('scores risk capture: under-flagging a crisis fails riskHit', () => {
    const crisis = NOTE_FIXTURES.find((f) => f.expectRisk === 'high')!;
    const underFlagged = {
      kind: 'TREATMENT',
      therapyNote: {
        version: 'V1',
        modality: 'CBT',
        subjective: 'x',
        objective: 'x',
        assessment: 'x',
        plan: 'x',
        riskFlags: { severity: 'none', indicators: [] },
        phaseHints: [],
      },
    } as unknown as Pass2Output;
    expect(scoreFixture(crisis, underFlagged).riskHit).toBe(false);

    const flagged = {
      kind: 'TREATMENT',
      therapyNote: {
        version: 'V1',
        modality: 'CBT',
        subjective: 'x',
        objective: 'x',
        assessment: 'x',
        plan: 'x',
        riskFlags: { severity: 'high', indicators: ['suicidal ideation'] },
        phaseHints: [],
      },
    } as unknown as Pass2Output;
    expect(scoreFixture(crisis, flagged).riskHit).toBe(true);
  });

  it('the gate fails when any fixture under-flags risk', () => {
    expect(
      passesGate({
        scores: [],
        total: 2,
        riskHits: 1,
        riskHitRate: 0.5,
        meanFactRecall: 0.9,
        sectionsCompleteAll: true,
      }),
    ).toBe(false);
    expect(
      passesGate({
        scores: [],
        total: 2,
        riskHits: 2,
        riskHitRate: 1,
        meanFactRecall: 0.7,
        sectionsCompleteAll: true,
      }),
    ).toBe(true);
  });
});
