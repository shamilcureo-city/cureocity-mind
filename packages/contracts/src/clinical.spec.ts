import { describe, expect, it } from 'vitest';
import {
  ClinicalReportV1Schema,
  ClinicalSectionConfirmationsSchema,
  ConfirmClinicalSectionInputSchema,
  GenerateTherapyScriptQuerySchema,
  Icd11CodeSchema,
  PENDING_SECTION_CONFIRMATIONS,
  TherapyScriptV1Schema,
  type ClinicalReportV1,
  type TherapyScriptV1,
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
      {
        question: 'Has the worry been daily for 6 months?',
        rationale: 'GAD criterion A',
        targets: [],
      },
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
    planSuggestions: [],
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
    expect(ConfirmClinicalSectionInputSchema.safeParse({ action: 'accept' }).success).toBe(true);
  });

  it('rejects action=modify without edits', () => {
    expect(
      ConfirmClinicalSectionInputSchema.safeParse({ action: 'modify', reason: 'tweak' }).success,
    ).toBe(false);
  });

  it('rejects action=reject without reason', () => {
    expect(ConfirmClinicalSectionInputSchema.safeParse({ action: 'reject' }).success).toBe(false);
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

describe('TherapyScriptV1Schema', () => {
  const valid: TherapyScriptV1 = {
    version: 'V1',
    language: 'en',
    therapyName: 'Cognitive Restructuring',
    openingScript: 'Hi, good to see you. Today we will work on the thoughts behind the anxiety.',
    mainExercise: {
      steps: [
        {
          id: 'orient',
          purpose: 'Set up the technique.',
          therapistSays:
            "Today I'm going to walk you through a tool called cognitive restructuring.",
          listenFor: 'Engagement vs. hesitation.',
          branches: [
            {
              ifClientSays: 'Sounds good',
              thenDo: 'Great — pick one anxious moment from this week.',
            },
          ],
        },
        {
          id: 'elicit',
          purpose: 'Get a specific thought.',
          therapistSays: 'What was going through your mind in that moment?',
          listenFor: 'A cognition rather than a feeling.',
          branches: [],
        },
      ],
    },
    adaptationCues: ['If client dissociates, switch to grounding.'],
    closingScript: 'Good work today. Try to catch one more thought like this before next session.',
    homework: {
      description: 'Catch one anxious thought each day and write it down.',
      deliveryNotes: 'Give the client a small notebook.',
    },
    riskWatchpoints: ['Suicidal ideation surfaces — stop the technique.'],
    estimatedDurationMin: 50,
  };

  it('accepts a representative script', () => {
    expect(TherapyScriptV1Schema.safeParse(valid).success).toBe(true);
  });

  it('rejects a script with zero steps', () => {
    expect(
      TherapyScriptV1Schema.safeParse({
        ...valid,
        mainExercise: { steps: [] },
      }).success,
    ).toBe(false);
  });

  it('rejects a step with empty therapistSays', () => {
    expect(
      TherapyScriptV1Schema.safeParse({
        ...valid,
        mainExercise: {
          steps: [{ ...valid.mainExercise.steps[0]!, therapistSays: '' }],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects estimatedDurationMin outside [5, 120]', () => {
    expect(TherapyScriptV1Schema.safeParse({ ...valid, estimatedDurationMin: 3 }).success).toBe(
      false,
    );
    expect(TherapyScriptV1Schema.safeParse({ ...valid, estimatedDurationMin: 200 }).success).toBe(
      false,
    );
  });

  it('accepts a Malayalam-language script', () => {
    const ml: TherapyScriptV1 = {
      ...valid,
      language: 'ml',
      openingScript: 'നമസ്കാരം. ഇന്ന് നമ്മൾ ഉത്കണ്ഠയ്ക്ക് പിന്നിലുള്ള ചിന്തകളിൽ പ്രവർത്തിക്കും.',
      closingScript:
        'നന്നായി പ്രവർത്തിച്ചു. അടുത്ത സെഷനു മുമ്പ് ഇതുപോലുള്ള ഒരു ചിന്ത പിടിക്കാൻ ശ്രമിക്കുക.',
    };
    expect(TherapyScriptV1Schema.safeParse(ml).success).toBe(true);
  });

  it('caps branches at 4', () => {
    const tooMany = Array.from({ length: 5 }, (_, i) => ({
      ifClientSays: `case ${i}`,
      thenDo: 'do something',
    }));
    expect(
      TherapyScriptV1Schema.safeParse({
        ...valid,
        mainExercise: {
          steps: [{ ...valid.mainExercise.steps[0]!, branches: tooMany }],
        },
      }).success,
    ).toBe(false);
  });
});

describe('GenerateTherapyScriptQuerySchema', () => {
  it('accepts a bare therapy name', () => {
    expect(
      GenerateTherapyScriptQuerySchema.safeParse({ therapy: 'Cognitive Restructuring' }).success,
    ).toBe(true);
  });

  it('coerces refresh=1 to boolean true', () => {
    const parsed = GenerateTherapyScriptQuerySchema.safeParse({
      therapy: 'Behavioural Activation',
      refresh: '1',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.refresh).toBe(true);
    }
  });

  it('rejects a malformed language code', () => {
    expect(
      GenerateTherapyScriptQuerySchema.safeParse({
        therapy: 'X',
        language: 'klingon',
      }).success,
    ).toBe(false);
  });
});
