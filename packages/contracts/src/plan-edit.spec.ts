import { describe, expect, it } from 'vitest';
import {
  PlanDictationRequestSchema,
  PlanDictationV1Schema,
  PlanEditCommandSchema,
} from './plan-edit';
import { RxPadPatchOpSchema } from './rx-pad';

describe('PlanEditCommandSchema', () => {
  it('parses the full command family', () => {
    const commands = [
      { action: 'addMed', drug: 'Atorvastatin', strength: '20 mg', frequency: 'HS' },
      { action: 'changeMed', drug: 'Amlodipine', strength: '10 mg' },
      { action: 'removeMed', drug: 'Aspirin' },
      { action: 'addInvestigation', name: 'Lipid profile' },
      { action: 'removeInvestigation', name: 'ECG' },
      { action: 'addAdvice', text: 'Salt-restricted diet' },
      { action: 'removeAdvice', text: 'Plenty of fluids' },
      { action: 'setFollowUp', when: 'In 2 weeks', withWhat: 'with reports' },
      { action: 'clearFollowUp' },
    ];
    for (const c of commands) {
      expect(PlanEditCommandSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
    }
  });

  it('rejects unknown actions and empty targets', () => {
    expect(PlanEditCommandSchema.safeParse({ action: 'renameMed', drug: 'X' }).success).toBe(false);
    expect(PlanEditCommandSchema.safeParse({ action: 'removeMed', drug: '' }).success).toBe(false);
  });
});

describe('PlanDictationV1Schema', () => {
  it('defaults edits + clarifications to empty', () => {
    const parsed = PlanDictationV1Schema.parse({});
    expect(parsed.edits).toEqual([]);
    expect(parsed.clarifications).toEqual([]);
  });

  it('caps edits at 20', () => {
    const edits = Array.from({ length: 21 }, (_, i) => ({
      action: 'addAdvice',
      text: `line ${i}`,
    }));
    expect(PlanDictationV1Schema.safeParse({ edits }).success).toBe(false);
  });
});

describe('PlanDictationRequestSchema', () => {
  it('requires text or audio', () => {
    expect(PlanDictationRequestSchema.safeParse({}).success).toBe(false);
    expect(PlanDictationRequestSchema.safeParse({ text: 'add paracetamol 650' }).success).toBe(
      true,
    );
  });

  it('requires durationMs alongside audio and rejects non-base64', () => {
    expect(PlanDictationRequestSchema.safeParse({ audioBase64: 'AAAA' }).success).toBe(false);
    expect(
      PlanDictationRequestSchema.safeParse({ audioBase64: 'AAAA', durationMs: 1200 }).success,
    ).toBe(true);
    expect(
      PlanDictationRequestSchema.safeParse({ audioBase64: 'not base64!!', durationMs: 1200 })
        .success,
    ).toBe(false);
  });
});

describe('RxPadPatchOpSchema (DS12 additions)', () => {
  it('parses unconfirmMed', () => {
    expect(RxPadPatchOpSchema.safeParse({ op: 'unconfirmMed', drug: 'Aspirin' }).success).toBe(
      true,
    );
  });
});
