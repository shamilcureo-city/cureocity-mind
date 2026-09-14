import { describe, expect, it, vi } from 'vitest';
import type { IPass2Backend, Pass2Output } from '../../types';
import type { NoteFixture } from './fixtures';
import { aggregate, scoreFixture } from './scorer';
import { formatReport, passesGate, runNoteEval } from './runner';

const fixture: NoteFixture = {
  id: 'fictional-counselling',
  language: 'en',
  modality: 'SUPPORTIVE',
  presentingConcerns: 'fictional',
  segments: [
    { speaker: 'client', text: 'Sleep is improving. No current plan.', startMs: 0, endMs: 1000 },
  ],
  expectFacts: ['sleep'],
  expectRisk: 'none',
  criticalFacts: [{ id: 'negated-plan', anyOf: ['no current plan'] }],
  forbiddenClaims: [{ id: 'invented-diagnosis', anyOf: ['confirmed bipolar diagnosis'] }],
};
function output(): Pass2Output {
  return {
    kind: 'TREATMENT',
    therapyNote: {
      version: 'V1',
      modality: 'SUPPORTIVE',
      subjective: 'Sleep is improving. No current plan.',
      objective: 'Not assessed.',
      assessment: 'Further assessment needed.',
      plan: 'Discuss at next visit.',
      riskFlags: { severity: 'none', indicators: [] },
      phaseHints: [],
      linkedEvidence: [],
    },
  };
}
function score(note = output(), expected = fixture) {
  return aggregate([scoreFixture(expected, note)]);
}

describe('deterministic note regression gate, not clinical validation', () => {
  it('passes a complete literal fixture and fails a missing required section', () => {
    expect(passesGate(score())).toBe(true);
    const note = output();
    if (note.kind !== 'TREATMENT') throw new Error();
    note.therapyNote.plan = '   ';
    expect(passesGate(score(note))).toBe(false);
  });
  it('over-flagging every calm case cannot pass', () => {
    const note = output();
    if (note.kind !== 'TREATMENT') throw new Error();
    note.therapyNote.riskFlags.severity = 'critical';
    const report = score(note);
    expect(report.riskHits).toBe(1); // legacy minimum check alone would pass
    expect(report.riskFalsePositives).toBe(1);
    expect(passesGate(report)).toBe(false);
  });
  it('reports false negatives separately and supports a reviewer-defined range', () => {
    expect(score(output(), { ...fixture, expectRisk: 'high' }).riskFalseNegatives).toBe(1);
    const note = output();
    if (note.kind !== 'TREATMENT') throw new Error();
    note.therapyNote.riskFlags.severity = 'low';
    expect(passesGate(score(note, { ...fixture, expectRiskMax: 'low' }))).toBe(true);
    expect(passesGate(score(note, { ...fixture, expectRisk: 'high', expectRiskMax: 'low' }))).toBe(
      false,
    );
  });
  it('fails critical negation omissions even when every legacy keyword is present', () => {
    const note = output();
    if (note.kind !== 'TREATMENT') throw new Error();
    note.therapyNote.subjective = 'Sleep is improving. Has a current plan.';
    const report = score(note);
    expect(report.meanFactRecall).toBe(1);
    expect(report.criticalOmissions).toBe(1);
    expect(passesGate(report)).toBe(false);
  });
  it('fails annotated unsupported claims in optional summaries/templates, without claiming general detection', () => {
    const note = output();
    if (note.kind !== 'TREATMENT') throw new Error();
    note.therapyNote.templateSections = [{ title: 'Draft', body: 'Confirmed bipolar diagnosis.' }];
    expect(score(note).forbiddenClaimHits).toBe(1);
    expect(passesGate(score(note))).toBe(false);
  });
  it('empty source/annotations and placeholder output cannot earn a pass', () => {
    expect(passesGate(score(output(), { ...fixture, segments: [] }))).toBe(false);
    expect(passesGate(score(output(), { ...fixture, expectFacts: [] }))).toBe(false);
    expect(
      passesGate(score(output(), { ...fixture, criticalFacts: [{ id: 'empty', anyOf: [] }] })),
    ).toBe(false);
    const note = output();
    if (note.kind !== 'TREATMENT') throw new Error();
    note.therapyNote.summary =
      'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).';
    expect(passesGate(score(note))).toBe(false);
  });
  it('keeps phrase word boundaries and rejects wrong note kinds', () => {
    const note = output();
    if (note.kind !== 'TREATMENT') throw new Error();
    note.therapyNote.subjective = 'Sleepless. No current plan.';
    expect(score(note).meanFactRecall).toBe(0);
    expect(passesGate(score(output(), { ...fixture, kind: 'INTAKE' }))).toBe(false);
  });
  it('redacts literal fact/claim text from routine reports', () => {
    const report = formatReport(score(), 'injected');
    expect(report).not.toContain('No current plan');
    expect(report).not.toContain('confirmed bipolar');
    expect(report).toContain('not clinical');
  });
  it('keeps reference and ASR note inputs separate; missing ASR does not use golden text', async () => {
    const run = vi.fn().mockResolvedValue({ output: output(), callLog: {} });
    const backend = { run } as IPass2Backend;
    const asr = { transcript: 'different actor ASR', speakerSegments: [] };
    const report = await runNoteEval(backend, [fixture], {
      kind: 'asr',
      transcripts: new Map([[fixture.id, asr]]),
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: asr.transcript,
        speakerSegments: [],
        vertical: 'THERAPIST',
      }),
    );
    expect(report.source).toBe('asr');
    run.mockClear();
    await expect(
      runNoteEval(backend, [fixture], { kind: 'asr', transcripts: new Map() }),
    ).rejects.toThrow('ASR_NOTE_SOURCE_UNAVAILABLE');
    expect(run).not.toHaveBeenCalled();
    await expect(
      runNoteEval(backend, [fixture], {
        kind: 'asr',
        transcripts: new Map([[fixture.id, { transcript: '', speakerSegments: [] }]]),
      }),
    ).rejects.toThrow('NOTE_SOURCE_UNAVAILABLE');
    expect(run).not.toHaveBeenCalled();
  });
  it('routes intake/review fixtures without forcing TREATMENT', async () => {
    const run = vi.fn().mockResolvedValue({ output: output(), callLog: {} });
    await runNoteEval({ run } as IPass2Backend, [{ ...fixture, kind: 'REVIEW' }]);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'REVIEW' }));
  });
});
