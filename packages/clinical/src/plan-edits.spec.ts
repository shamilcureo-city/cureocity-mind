import { describe, expect, it } from 'vitest';
import type { PlanDictationV1, RxPadDraft } from '@cureocity/contracts';
import { proposePlanEdits } from './plan-edits';

const pad: RxPadDraft = {
  version: 'V1',
  meds: [
    {
      drug: 'Amlodipine',
      strength: '5 mg',
      frequency: 'OD',
      continued: false,
      status: 'confirmed',
      warnings: [],
    },
    {
      drug: 'Warfarin',
      strength: '2 mg',
      frequency: 'OD',
      continued: true,
      status: 'confirmed',
      warnings: [],
    },
  ],
  investigations: [{ name: '12-lead ECG' }],
  adviceLines: ['Salt-restricted diet'],
  followUp: { when: 'In 3 days' },
};

const dictation = (edits: PlanDictationV1['edits']): PlanDictationV1 => ({
  version: 'V1',
  edits,
  clarifications: [],
});

describe('proposePlanEdits', () => {
  it('maps changeMed to remove + re-add with merged fields', () => {
    const { changes, skipped } = proposePlanEdits(
      pad,
      dictation([{ action: 'changeMed', drug: 'amlodipine', strength: '10 mg' }]),
    );
    expect(skipped).toEqual([]);
    expect(changes).toHaveLength(1);
    const change = changes[0]!;
    expect(change.kind).toBe('change');
    expect(change.before).toBe('Amlodipine · 5 mg · OD');
    expect(change.after).toBe('Amlodipine · 10 mg · OD'); // frequency kept
    expect(change.ops).toEqual([
      { op: 'removeMed', drug: 'Amlodipine' },
      {
        op: 'addMed',
        source: 'dictated',
        med: { drug: 'Amlodipine', strength: '10 mg', frequency: 'OD' },
      },
    ]);
  });

  it('upgrades addMed of an existing drug to a change', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([{ action: 'addMed', drug: 'Amlodipine', strength: '10 mg' }]),
    );
    expect(changes[0]!.kind).toBe('change');
  });

  it('downgrades changeMed of an unknown drug to an add', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([
        { action: 'changeMed', drug: 'Atorvastatin', strength: '20 mg', frequency: 'HS' },
      ]),
    );
    expect(changes[0]).toMatchObject({ kind: 'add', target: 'med' });
    expect(changes[0]!.ops).toEqual([
      {
        op: 'addMed',
        source: 'dictated',
        med: { drug: 'Atorvastatin', strength: '20 mg', frequency: 'HS' },
      },
    ]);
  });

  it('resolves a unique substring target to the stored row', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([{ action: 'removeInvestigation', name: 'ecg' }]),
    );
    expect(changes[0]!.ops).toEqual([{ op: 'removeInvestigation', name: '12-lead ECG' }]);
  });

  it('skips removals of rows that are not on the pad', () => {
    const { changes, skipped } = proposePlanEdits(
      pad,
      dictation([{ action: 'removeMed', drug: 'Metformin' }]),
    );
    expect(changes).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('Metformin');
  });

  it('turns an ambiguous target into a clarification, not a guess', () => {
    const twoStatins: RxPadDraft = {
      ...pad,
      meds: [
        { drug: 'Rosuvastatin', continued: false, status: 'confirmed', warnings: [] },
        { drug: 'Atorvastatin', continued: false, status: 'confirmed', warnings: [] },
      ],
    };
    const { changes, clarifications } = proposePlanEdits(
      twoStatins,
      dictation([{ action: 'removeMed', drug: 'statin' }]),
    );
    expect(changes).toEqual([]);
    expect(clarifications).toHaveLength(1);
    expect(clarifications[0]).toContain('Rosuvastatin');
    expect(clarifications[0]).toContain('Atorvastatin');
  });

  it('flags a NEW interaction introduced by an added med', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([{ action: 'addMed', drug: 'Aspirin', strength: '75 mg' }]),
    );
    expect(changes[0]!.warnings.length).toBeGreaterThan(0);
    expect(changes[0]!.warnings[0]).toMatch(/warfarin/i);
  });

  it('does not re-flag interactions that already exist on the pad', () => {
    const withAspirin: RxPadDraft = {
      ...pad,
      meds: [
        ...(pad.meds ?? []),
        { drug: 'Aspirin', continued: false, status: 'confirmed', warnings: [] },
      ],
    };
    const { changes } = proposePlanEdits(
      withAspirin,
      dictation([{ action: 'changeMed', drug: 'Aspirin', strength: '150 mg' }]),
    );
    expect(changes[0]!.warnings).toEqual([]);
  });

  it('handles follow-up set / change / clear', () => {
    const set = proposePlanEdits(
      pad,
      dictation([{ action: 'setFollowUp', when: 'In 2 weeks', withWhat: 'with reports' }]),
    );
    expect(set.changes[0]).toMatchObject({ kind: 'change', target: 'followUp' });
    expect(set.changes[0]!.before).toBe('In 3 days');

    const noFollowUp: RxPadDraft = { ...pad };
    delete noFollowUp.followUp;
    const add = proposePlanEdits(
      noFollowUp,
      dictation([{ action: 'setFollowUp', when: 'In 2 weeks' }]),
    );
    expect(add.changes[0]!.kind).toBe('add');

    const clear = proposePlanEdits(pad, dictation([{ action: 'clearFollowUp' }]));
    expect(clear.changes[0]!.ops).toEqual([{ op: 'clearFollowUp' }]);

    const clearEmpty = proposePlanEdits(noFollowUp, dictation([{ action: 'clearFollowUp' }]));
    expect(clearEmpty.changes).toEqual([]);
    expect(clearEmpty.skipped).toHaveLength(1);
  });

  it('skips no-op changes and duplicate adds', () => {
    const noop = proposePlanEdits(
      pad,
      dictation([{ action: 'changeMed', drug: 'Amlodipine', strength: '5 mg' }]),
    );
    expect(noop.changes).toEqual([]);
    expect(noop.skipped).toHaveLength(1);

    const dupTest = proposePlanEdits(
      pad,
      dictation([{ action: 'addInvestigation', name: '12-lead ecg' }]),
    );
    expect(dupTest.changes).toEqual([]);
    expect(dupTest.skipped).toHaveLength(1);

    const dupAdvice = proposePlanEdits(
      pad,
      dictation([{ action: 'addAdvice', text: 'salt-restricted diet' }]),
    );
    expect(dupAdvice.changes).toEqual([]);
  });

  it('works from an empty pad ("dictate the whole plan")', () => {
    const { changes, skipped } = proposePlanEdits(
      null,
      dictation([
        { action: 'addMed', drug: 'Paracetamol', strength: '650 mg', frequency: 'TDS' },
        { action: 'addInvestigation', name: 'CBC' },
        { action: 'addAdvice', text: 'Plenty of fluids' },
        { action: 'setFollowUp', when: 'In 3 days' },
      ]),
    );
    expect(skipped).toEqual([]);
    expect(changes).toHaveLength(4);
    expect(changes.every((c) => c.kind === 'add')).toBe(true);
  });

  it('passes model clarifications through', () => {
    const { clarifications } = proposePlanEdits(pad, {
      version: 'V1',
      edits: [],
      clarifications: ['Atorvastatin 20 — at night?'],
    });
    expect(clarifications).toEqual(['Atorvastatin 20 — at night?']);
  });

  it('keeps a PENDING med pending through a voice change — and says so', () => {
    const withPending: RxPadDraft = {
      ...pad,
      meds: [
        {
          drug: 'Amlodipine',
          strength: '5 mg',
          continued: false,
          status: 'pending',
          warnings: [],
        },
      ],
    };
    const { changes } = proposePlanEdits(
      withPending,
      dictation([{ action: 'changeMed', drug: 'Amlodipine', strength: '10 mg' }]),
    );
    const change = changes[0]!;
    expect(change.after).toContain('stays pending confirm');
    expect(change.ops).toEqual([
      { op: 'removeMed', drug: 'Amlodipine' },
      { op: 'addMed', source: 'dictated', med: { drug: 'Amlodipine', strength: '10 mg' } },
      { op: 'unconfirmMed', drug: 'Amlodipine' },
    ]);
  });

  it('keeps the continued badge through a change of a carried-forward med', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([{ action: 'changeMed', drug: 'Warfarin', strength: '3 mg' }]),
    );
    const addOp = changes[0]!.ops.find((o) => o.op === 'addMed');
    expect(addOp).toMatchObject({ med: { drug: 'Warfarin', continued: true } });
  });

  it('composes two edits on the same drug into ONE diff line', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([
        { action: 'changeMed', drug: 'Amlodipine', strength: '10 mg' },
        { action: 'changeMed', drug: 'Amlodipine', frequency: 'BD' },
      ]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.after).toBe('Amlodipine · 10 mg · BD');
    expect(changes[0]!.ops.filter((o) => o.op === 'removeMed')).toHaveLength(1);
  });

  it('change then remove of the same drug collapses to a single remove', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([
        { action: 'changeMed', drug: 'Amlodipine', strength: '10 mg' },
        { action: 'removeMed', drug: 'Amlodipine' },
      ]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'remove', target: 'med', label: 'Amlodipine' });
    expect(changes[0]!.ops).toEqual([{ op: 'removeMed', drug: 'Amlodipine' }]);
  });

  it('add then remove of a new drug nets to no change', () => {
    const { changes, skipped } = proposePlanEdits(
      pad,
      dictation([
        { action: 'addMed', drug: 'Paracetamol', strength: '650 mg' },
        { action: 'removeMed', drug: 'Paracetamol' },
      ]),
    );
    expect(changes).toEqual([]);
    expect(skipped.some((s) => s.includes('Paracetamol'))).toBe(true);
  });

  it('attaches a brand-name interaction to the diff line (Ecosprin → Aspirin)', () => {
    const { changes } = proposePlanEdits(
      pad,
      dictation([{ action: 'addMed', drug: 'Ecosprin', strength: '75 mg' }]),
    );
    expect(changes[0]!.warnings.length).toBeGreaterThan(0);
    expect(changes[0]!.warnings[0]).toMatch(/warfarin/i);
  });
});
