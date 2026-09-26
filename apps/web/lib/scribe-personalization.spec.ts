import { describe, expect, it } from 'vitest';
import { RxPadPatchInputSchema } from '@cureocity/contracts';
import {
  DEFAULT_SCRIBE_NOTE_STYLE,
  ScribeNoteStyleSchema,
  ScribeShortcutSchema,
} from './scribe-personalization-contracts';
import {
  applyScribeCorrection,
  previewScribeCorrection,
  undoScribeCorrection,
} from './scribe-corrections';
import { scribeFavoriteSetFromPad, scribeShortcutOps } from './scribe-shortcuts';

describe('Scribe reusable clinical content', () => {
  it('applies a five-medicine set within one ten-op request with every medicine still pending', () => {
    const body = ScribeShortcutSchema.parse({
      type: 'set',
      title: 'Reusable prescription',
      items: Array.from({ length: 5 }, (_unused, index) => ({
        type: 'medication',
        title: `Example ${['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'][index]}`,
        med: { drug: `Example ${['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'][index]}` },
      })),
    });
    const ops = scribeShortcutOps(body, null);
    expect(ops).toHaveLength(10);
    expect(RxPadPatchInputSchema.safeParse({ ops }).success).toBe(true);
    expect(ops.filter((op) => op.op === 'unconfirmMed')).toHaveLength(5);
    expect(ops.some((op) => op.op === 'confirmMed')).toBe(false);
    expect(() =>
      scribeShortcutOps(body, {
        meds: [{ drug: 'Example Alpha', status: 'confirmed', continued: false, warnings: [] }],
      }),
    ).toThrow('already on the plan');
  });
  it('rejects oversize sets, nested sets, phrases and duplicate items', () => {
    const item = { type: 'investigation', title: 'Example test', name: 'Example test' };
    expect(
      ScribeShortcutSchema.safeParse({ type: 'set', title: 'Oversize', items: Array(6).fill(item) })
        .success,
    ).toBe(false);
    expect(
      ScribeShortcutSchema.safeParse({
        type: 'set',
        title: 'Nested',
        items: [{ type: 'set', title: 'Inner', items: [item] }],
      }).success,
    ).toBe(false);
    expect(
      ScribeShortcutSchema.safeParse({
        type: 'set',
        title: 'Phrase',
        items: [{ type: 'phrase', title: 'Note', field: 'hpi', text: 'Patient note.' }],
      }).success,
    ).toBe(false);
    const duplicate = ScribeShortcutSchema.parse({
      type: 'set',
      title: 'Repeated',
      items: [item, item],
    });
    expect(() => scribeShortcutOps(duplicate, null)).toThrow('duplicate');
  });
  it('saves only reusable items from the current draft, omitting pending medicines and patient context', () => {
    const body = scribeFavoriteSetFromPad({
      dxLine: 'Patient-specific diagnosis',
      allergies: ['Patient allergy'],
      vitalsLine: 'Patient vitals',
      followUp: { when: 'Tomorrow' },
      meds: [
        {
          drug: 'Reviewed medicine',
          status: 'confirmed',
          continued: true,
          warnings: ['Patient warning'],
          source: 'dictated',
          utteranceId: 'source-patient',
          previous: 'Old prescription',
        },
        { drug: 'Unreviewed medicine', status: 'pending', continued: false, warnings: [] },
      ],
      investigations: [
        {
          name: 'Example test',
          rationale: 'Patient-specific context',
          source: 'ai',
          utteranceId: 'source-patient',
        },
      ],
      adviceLines: ['Reusable advice'],
    });
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({ type: 'medication', med: { drug: 'Reviewed medicine' } });
    const serialized = JSON.stringify(body);
    for (const excluded of [
      'Patient-specific',
      'Patient allergy',
      'Patient vitals',
      'Tomorrow',
      'Unreviewed',
      'Patient warning',
      'source-patient',
      'Old prescription',
      'confirmed',
      'continued',
    ])
      expect(serialized).not.toContain(excluded);
    expect(scribeShortcutOps(body, null)[1]).toEqual({
      op: 'unconfirmMed',
      drug: 'Reviewed medicine',
    });
  });
  it('adds a medicine favorite as pending through one atomic audited operation group', () => {
    const shortcut = ScribeShortcutSchema.parse({
      type: 'medication',
      title: 'Example medicine',
      med: { drug: 'Example drug', strength: '5 mg' },
    });
    const ops = scribeShortcutOps(shortcut, null);
    expect(RxPadPatchInputSchema.safeParse({ ops }).success).toBe(true);
    expect(ops).toEqual([
      { op: 'addMed', source: 'manual', med: { drug: 'Example drug', strength: '5 mg' } },
      { op: 'unconfirmMed', drug: 'Example drug' },
    ]);
    expect(ops.some((op) => op.op === 'confirmMed')).toBe(false);
  });
  it('does not let a favorite overwrite an existing medicine or smuggle prescribing status', () => {
    const favorite = {
      type: 'medication' as const,
      title: 'Example',
      med: { drug: 'Example drug' },
    };
    expect(() =>
      scribeShortcutOps(favorite, {
        meds: [{ drug: 'Example drug', continued: false, status: 'confirmed', warnings: [] }],
      }),
    ).toThrow('already on the plan');
    expect(
      ScribeShortcutSchema.safeParse({ ...favorite, med: { ...favorite.med, status: 'confirmed' } })
        .success,
    ).toBe(false);
    expect(
      ScribeShortcutSchema.safeParse({ ...favorite, psychologistId: 'another-doctor' }).success,
    ).toBe(false);
  });
  it('keeps saved phrases out of prescriptions and rejects duplicate investigations/advice', () => {
    expect(() =>
      scribeShortcutOps(
        { type: 'phrase', title: 'Opening', field: 'hpi', text: 'Reviewed symptoms.' },
        null,
      ),
    ).toThrow('note editor');
    expect(() =>
      scribeShortcutOps(
        { type: 'investigation', title: 'ECG', name: 'ECG' },
        { investigations: [{ name: 'ecg' }] },
      ),
    ).toThrow('already on the plan');
    expect(() =>
      scribeShortcutOps(
        { type: 'advice', title: 'Return', text: 'Return with reports.' },
        { adviceLines: ['Return with reports.'] },
      ),
    ).toThrow('already on the plan');
  });
});

describe('doctor note presentation profiles', () => {
  it('permits independent first-visit and follow-up ordering without omitting clinical sections', () => {
    const style = structuredClone(DEFAULT_SCRIBE_NOTE_STYLE);
    style.followUp.order.reverse();
    style.followUp.labels.hpi = 'Interval history';
    expect(ScribeNoteStyleSchema.parse(style).firstVisit.order[0]).toBe('chiefComplaint');
    expect(ScribeNoteStyleSchema.parse(style).followUp.labels.hpi).toBe('Interval history');
    style.followUp.order[0] = style.followUp.order[1]!;
    expect(ScribeNoteStyleSchema.safeParse(style).success).toBe(false);
  });
  it('does not accept content-generation instructions as style settings', () => {
    expect(
      ScribeNoteStyleSchema.safeParse({
        ...DEFAULT_SCRIBE_NOTE_STYLE,
        prompt: 'Invent a normal exam',
      }).success,
    ).toBe(false);
  });
});

describe('explicit correction preview and guarded undo', () => {
  it('proposes a literal replacement and retains the exact original for undo', () => {
    const before = 'Dose recorded as 5 mg.';
    const proposal = previewScribeCorrection(before, 'replace "5 mg" with "10 mg"');
    expect(before).toBe('Dose recorded as 5 mg.');
    expect(applyScribeCorrection(before, proposal)).toBe('Dose recorded as 10 mg.');
    expect(undoScribeCorrection(proposal.after, proposal)).toBe(before);
  });
  it('does not run regex or replacement-string commands', () => {
    expect(previewScribeCorrection('Value .* present.', 'replace ".*" with "$&"').after).toBe(
      'Value $& present.',
    );
    expect(() => previewScribeCorrection('Old and Old', 'replace "Old" with "New"')).toThrow(
      'More than one match',
    );
    expect(() => previewScribeCorrection('Current text', 'replace "absent" with "value"')).toThrow(
      'not in this section',
    );
  });
  it('refuses stale preview or undo rather than overwriting later clinician edits', () => {
    const proposal = previewScribeCorrection('Initial', 'append: Added');
    expect(() => applyScribeCorrection('Revised', proposal)).toThrow('changed after preview');
    expect(() => undoScribeCorrection('Initial\nAdded\nNew work', proposal)).toThrow('newer edits');
    expect(() => previewScribeCorrection('Initial', 'sign the note')).toThrow('Use replace');
  });
});
