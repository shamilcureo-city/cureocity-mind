import { describe, expect, it } from 'vitest';
import { TherapyNoteV1Schema, IntakeNoteV1Schema } from '@cureocity/contracts';
import { narrativeChanges, readMindNoteProposal } from './mind-note-proposal';

const current = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'SUPPORTIVE',
  subjective: 'Fictional client account.',
  objective: 'Fictional observations.',
  assessment: 'Further information needed.',
  plan: 'Review the agreed focus at the next visit.',
  summary: 'Old derived summary',
  riskFlags: { severity: 'medium', indicators: ['Fictional cue'] },
});
const version = '2026-09-14T10:00:00.000Z';
const packet = {
  applied: false,
  kind: 'TREATMENT',
  baseUpdatedAt: version,
  note: { ...current, plan: 'Review the agreed focus next visit.' },
};

describe('Mind proposed narrative edits', () => {
  it('compares changed narrative only and clears outdated derived views', () => {
    const preview = readMindNoteProposal(packet, current, version);
    expect(narrativeChanges(current, preview.note)).toEqual([
      { field: 'plan', label: 'Plan', before: current.plan, after: packet.note.plan },
    ]);
    expect(preview.note).not.toHaveProperty('summary');
    expect(current.summary).toBe('Old derived summary');
  });
  it('does not take changed safety or modality from a model', () => {
    const preview = readMindNoteProposal(
      {
        ...packet,
        note: { ...packet.note, modality: 'CBT', riskFlags: { severity: 'none', indicators: [] } },
      },
      current,
      version,
    );
    expect(preview.note.riskFlags).toEqual(current.riskFlags);
    expect(preview.note).toHaveProperty('modality', 'SUPPORTIVE');
  });
  it.each([
    null,
    {},
    { ...packet, applied: true },
    { ...packet, kind: 'INTAKE' },
    { ...packet, baseUpdatedAt: '2026-09-13T10:00:00.000Z' },
    { ...packet, note: {} },
  ])('rejects malformed, applied, wrong-kind or stale previews', (value) => {
    expect(() => readMindNoteProposal(value, current, version)).toThrow();
  });
  it('supports intake fields without inventing treatment fields', () => {
    const intake = IntakeNoteV1Schema.parse({
      version: 'V1',
      presentingConcerns: 'Fictional concern',
      historyOfPresentingIllness: 'History',
      pastPsychiatricHistory: 'Not discussed',
      familyHistory: 'Not discussed',
      socialHistory: 'Not discussed',
      mentalStatusExam: 'Fictional observations',
      workingHypothesis: 'Further information needed',
      immediatePlan: 'Review agreed focus',
      riskFlags: { severity: 'none', indicators: [] },
    });
    const preview = readMindNoteProposal(
      {
        applied: false,
        kind: 'INTAKE',
        baseUpdatedAt: version,
        note: { ...intake, immediatePlan: 'Review the agreed focus next visit' },
      },
      intake,
      version,
    );
    expect(narrativeChanges(intake, preview.note).map((change) => change.field)).toEqual([
      'immediatePlan',
    ]);
  });
});
