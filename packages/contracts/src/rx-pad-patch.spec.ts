import { describe, expect, it } from 'vitest';
import { DifferentialDiagnosisV1Schema, RxPadPatchInputSchema, RxPadV1Schema } from './index';

/** Sprint DS10-B — plan-composer contracts. */
describe('RxPadPatchInputSchema', () => {
  it('accepts an adopt-med op with a source', () => {
    const parsed = RxPadPatchInputSchema.safeParse({
      ops: [
        {
          op: 'addMed',
          source: 'ai',
          med: { drug: 'Paracetamol', strength: '650 mg', frequency: '1-1-1', durationDays: 3 },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown op and an empty ops array', () => {
    expect(RxPadPatchInputSchema.safeParse({ ops: [{ op: 'nuke' }] }).success).toBe(false);
    expect(RxPadPatchInputSchema.safeParse({ ops: [] }).success).toBe(false);
  });

  it('requires source on additive ops (adoption provenance is mandatory)', () => {
    expect(
      RxPadPatchInputSchema.safeParse({ ops: [{ op: 'addAdvice', text: 'Rest well' }] }).success,
    ).toBe(false);
  });
});

describe('RxPadV1Schema source field (DS10-B)', () => {
  it('parses pre-DS10 rows without source', () => {
    const parsed = RxPadV1Schema.safeParse({
      version: 'V1',
      meds: [{ drug: 'Aspirin', status: 'confirmed' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts source on med + investigation rows', () => {
    const parsed = RxPadV1Schema.safeParse({
      version: 'V1',
      meds: [{ drug: 'Aspirin', status: 'confirmed', source: 'ai' }],
      investigations: [{ name: 'CBC', source: 'manual' }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('DifferentialDiagnosisV1Schema suggestedPlan (DS10-B)', () => {
  it('defaults suggestedPlan on pre-DS10 stored rows', () => {
    const parsed = DifferentialDiagnosisV1Schema.parse({ version: 'V1' });
    expect(parsed.suggestedPlan).toEqual({
      investigations: [],
      medications: [],
      advice: [],
      examSteps: [],
    });
  });

  it('parses a full suggested plan', () => {
    const parsed = DifferentialDiagnosisV1Schema.safeParse({
      version: 'V1',
      suggestedPlan: {
        investigations: [{ name: 'Dengue NS1', rationale: 'monsoon fever' }],
        medications: [{ drug: 'Paracetamol', strength: '650 mg', rationale: 'antipyretic' }],
        advice: ['Hydration'],
        followUp: { when: 'In 3 days', withWhat: 'reports' },
        examSteps: ['Throat examination'],
      },
    });
    expect(parsed.success).toBe(true);
  });
});
