import { describe, expect, it } from 'vitest';
import {
  ClinicalReportV1Schema,
  ClinicalSectionConfirmationsSchema,
  ConfirmClinicalSectionInputSchema,
  Icd11CodeSchema,
  PENDING_SECTION_CONFIRMATIONS,
  type ClinicalReportV1,
} from './clinical';

describe('Icd11CodeSchema', () => {
  it.each(['6B00', '6B01', '6B01.0', '6C20', '6C20.1', '6D11.Z'])(
    'accepts valid ICD-11 stem code %s',
    (code) => {
      expect(Icd11CodeSchema.safeParse(code).success).toBe(true);
    },
  );

  it.each(['F32', 'ABC', '6b01', 'panic', ''])('rejects malformed code %s', (code) => {
    expect(Icd11CodeSchema.safeParse(code).success).toBe(false);
  });
});

describe('ClinicalReportV1Schema', () => {
  const valid: ClinicalReportV1 = {
    version: 'V1',
    language: 'en',
    modality: 'CBT',
    diagnosisCandidates: [
      {
        icd11Code: '6B00',
        icd11Label: 'Generalised anxiety disorder',
        confidence: 0.6,
        supportingEvidence: [
          {
            quote: 'I worry about everything every day.',
            speaker: 'client',
            startMs: 12_000,
          },
        ],
        gapsToFill: ['Duration > 6 months'],
      },
    ],
    primaryDiagnosisIndex: 0,
    assessmentGaps: [
      { question: 'Has the worry been daily for 6 months?', rationale: 'GAD criterion A' },
    ],
    formulation:
      'Working hypothesis: client presents with persistent worry triggered by work demands.',
    treatmentPlan: {
      modality: 'CBT',
      phaseSequence: ['psychoeducation', 'restructuring'],
      goals: [{ description: 'Reduce GAD-7 by 4', measure: 'GAD-7 every 4 sessions' }],
      expectedDurationSessions: 12,
    },
    recommendedTherapies: [
      {
        name: 'Cognitive Restructuring',
        rationale: 'Targets catastrophic cognitions about meetings.',
        evidenceSummary: 'CBT for GAD: first-line per meta-analyses.',
        whenInPlan: 'restructuring',
      },
    ],
    crisisFlags: [],
  };

  it('accepts a representative report', () => {
    const parsed = ClinicalReportV1Schema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects a diagnosis candidate with zero supporting quotes', () => {
    const broken = {
      ...valid,
      diagnosisCandidates: [{ ...valid.diagnosisCandidates[0]!, supportingEvidence: [] }],
    };
    const parsed = ClinicalReportV1Schema.safeParse(broken);
    expect(parsed.success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    const broken = {
      ...valid,
      diagnosisCandidates: [{ ...valid.diagnosisCandidates[0]!, confidence: 1.5 }],
    };
    expect(ClinicalReportV1Schema.safeParse(broken).success).toBe(false);
  });

  it('rejects a treatment plan with no phases', () => {
    const broken = {
      ...valid,
      treatmentPlan: { ...valid.treatmentPlan, phaseSequence: [] },
    };
    expect(ClinicalReportV1Schema.safeParse(broken).success).toBe(false);
  });

  it('rejects a plan with a goal missing the measure', () => {
    const broken = {
      ...valid,
      treatmentPlan: {
        ...valid.treatmentPlan,
        goals: [{ description: 'reduce anxiety', measure: '' }],
      },
    };
    expect(ClinicalReportV1Schema.safeParse(broken).success).toBe(false);
  });

  it('allows a null primaryDiagnosisIndex (too uncertain)', () => {
    const parsed = ClinicalReportV1Schema.safeParse({
      ...valid,
      primaryDiagnosisIndex: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a malayalam-language report', () => {
    const parsed = ClinicalReportV1Schema.safeParse({
      ...valid,
      language: 'ml',
      formulation: 'പ്രവർത്തന അന്തരീക്ഷത്തിലെ സമ്മർദ്ദം മൂലം നിലനിൽക്കുന്ന ഉത്കണ്ഠ.',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('ConfirmClinicalSectionInputSchema', () => {
  it('accepts action=accept with no reason or edits', () => {
    expect(
      ConfirmClinicalSectionInputSchema.safeParse({ action: 'accept' }).success,
    ).toBe(true);
  });

  it('rejects action=modify without edits', () => {
    expect(
      ConfirmClinicalSectionInputSchema.safeParse({ action: 'modify', reason: 'tweak' })
        .success,
    ).toBe(false);
  });

  it('rejects action=reject without reason', () => {
    expect(
      ConfirmClinicalSectionInputSchema.safeParse({ action: 'reject' }).success,
    ).toBe(false);
  });

  it('accepts action=modify with reason + edits', () => {
    expect(
      ConfirmClinicalSectionInputSchema.safeParse({
        action: 'modify',
        reason: 'narrowing the differential',
        edits: { foo: 'bar' },
      }).success,
    ).toBe(true);
  });

  it('accepts action=reject with reason', () => {
    expect(
      ConfirmClinicalSectionInputSchema.safeParse({
        action: 'reject',
        reason: 'evidence too thin',
      }).success,
    ).toBe(true);
  });
});

describe('PENDING_SECTION_CONFIRMATIONS', () => {
  it('passes the confirmations schema', () => {
    const parsed = ClinicalSectionConfirmationsSchema.safeParse(PENDING_SECTION_CONFIRMATIONS);
    expect(parsed.success).toBe(true);
  });
});
