import { describe, expect, it } from 'vitest';
import {
  DeleteNoteEditRecoveryInputSchema,
  PutNoteEditRecoveryInputSchema,
} from './note-edit-recovery';

const base = {
  revision: 0,
  mutationId: 'eae9ed6e-fbee-4426-8123-898cc5255010',
  baseUpdatedAt: '2026-09-07T10:00:00.000Z',
  kind: 'TREATMENT',
  fields: { subjective: '', objective: '', assessment: '', plan: '' },
};
describe('manual-edit checkpoint contracts', () => {
  it('accepts incomplete text and preserves whitespace without pretending it is signable', () => {
    const result = PutNoteEditRecoveryInputSchema.parse({
      ...base,
      fields: { ...base.fields, plan: '  unfinished\n' },
    });
    if (result.kind !== 'TREATMENT') throw new Error('Expected a treatment checkpoint');
    expect(result.fields.plan).toBe('  unfinished\n');
  });
  it.each([
    { ...base, fields: { ...base.fields, riskFlags: 'none' } },
    { ...base, fields: { subjective: '' } },
    { ...base, fields: { ...base.fields, plan: null } },
    { ...base, fields: { ...base.fields, plan: 'x'.repeat(20_001) } },
    { ...base, kind: 'INTAKE' },
    { ...base, revision: -1 },
    { ...base, revision: 0.5 },
    { ...base, revision: 2_147_483_647 },
    { ...base, mutationId: 'not-a-uuid' },
    { ...base, baseUpdatedAt: 'yesterday' },
    { ...base, transcript: 'not editable' },
  ])('rejects malformed, unbounded or extra clinical input %#', (input) => {
    expect(PutNoteEditRecoveryInputSchema.safeParse(input).success).toBe(false);
  });
  it('accepts exactly the eight intake fields, but bounds their combined size', () => {
    const fields = {
      presentingConcerns: '',
      historyOfPresentingIllness: '',
      pastPsychiatricHistory: '',
      familyHistory: '',
      socialHistory: '',
      mentalStatusExam: '',
      workingHypothesis: '',
      immediatePlan: '',
    };
    expect(
      PutNoteEditRecoveryInputSchema.safeParse({ ...base, kind: 'INTAKE', fields }).success,
    ).toBe(true);
    expect(
      PutNoteEditRecoveryInputSchema.safeParse({
        ...base,
        kind: 'INTAKE',
        fields: Object.fromEntries(Object.keys(fields).map((key) => [key, 'x'.repeat(20_000)])),
      }).success,
    ).toBe(false);
  });
  it('accepts only revision and mutation identity when discarding', () => {
    expect(
      DeleteNoteEditRecoveryInputSchema.safeParse({ revision: 0, mutationId: base.mutationId })
        .success,
    ).toBe(true);
    expect(DeleteNoteEditRecoveryInputSchema.safeParse(base).success).toBe(false);
  });
});
