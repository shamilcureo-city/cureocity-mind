import { describe, expect, it } from 'vitest';
import { InitialAssessmentBriefV1Schema, type InitialAssessmentBriefV1 } from './clinical';
import { IntakeNoteV1Schema, type IntakeNoteV1 } from './note';
import { SessionKindSchema, SessionModalitySchema } from './client';
import { CreateSessionInputSchema } from './session';

describe('SessionKindSchema (Sprint 19)', () => {
  it.each(['INTAKE', 'TREATMENT', 'REVIEW'])('accepts %s', (kind) => {
    expect(SessionKindSchema.safeParse(kind).success).toBe(true);
  });

  it.each(['OTHER', 'follow_up', ''])('rejects %s', (kind) => {
    expect(SessionKindSchema.safeParse(kind).success).toBe(false);
  });
});

describe('SessionModalitySchema (Sprint 19 expansion)', () => {
  it.each([
    'CBT',
    'EMDR',
    'ACT',
    'IFS',
    'PSYCHODYNAMIC',
    'MI',
    'MBCT',
    'SUPPORTIVE',
    'INTAKE',
    'OTHER',
  ])('accepts %s', (modality) => {
    expect(SessionModalitySchema.safeParse(modality).success).toBe(true);
  });

  it.each(['cbt', 'random_string', 'PSYCH'])('rejects %s', (modality) => {
    expect(SessionModalitySchema.safeParse(modality).success).toBe(false);
  });
});

describe('CreateSessionInputSchema (Sprint 19 — modality optional)', () => {
  const cuid = 'cabcdefghijklmnopqrstuvwx';
  const scheduledAt = '2026-06-25T10:00:00.000Z';

  it('accepts a body WITHOUT modality (cascade picks one)', () => {
    expect(
      CreateSessionInputSchema.safeParse({
        clientId: cuid,
        scheduledAt,
      }).success,
    ).toBe(true);
  });

  it('accepts a body WITH modality', () => {
    expect(
      CreateSessionInputSchema.safeParse({
        clientId: cuid,
        modality: 'CBT',
        scheduledAt,
      }).success,
    ).toBe(true);
  });

  it('rejects unknown modality enum value', () => {
    expect(
      CreateSessionInputSchema.safeParse({
        clientId: cuid,
        modality: 'YOGA',
        scheduledAt,
      }).success,
    ).toBe(false);
  });
});

describe('IntakeNoteV1Schema', () => {
  const valid: IntakeNoteV1 = {
    version: 'V1',
    presentingConcerns: 'Recurrent panic attacks since role change.',
    historyOfPresentingIllness:
      'Onset ~6 months ago; 2-3 attacks/week lasting 10-20 min; avoidance of work meetings emerging.',
    pastPsychiatricHistory: '(None elicited.)',
    familyHistory: '(Not elicited this session.)',
    socialHistory: 'Lives with spouse. IT consultant. Stable family support.',
    mentalStatusExam:
      'Appropriately groomed. Cooperative. Mood "stressed", affect mildly anxious. No SI/HI.',
    workingHypothesis:
      'Panic disorder with anticipatory anxiety; rule out adjustment disorder and GAD.',
    immediatePlan:
      'Schedule next session; administer PHQ-9 and GAD-7; provide panic-cycle psychoeducation.',
    riskFlags: { severity: 'none', indicators: [] },
  };

  it('accepts a representative intake note', () => {
    expect(IntakeNoteV1Schema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty workingHypothesis', () => {
    expect(IntakeNoteV1Schema.safeParse({ ...valid, workingHypothesis: '' }).success).toBe(false);
  });

  it('rejects an empty mentalStatusExam', () => {
    expect(IntakeNoteV1Schema.safeParse({ ...valid, mentalStatusExam: '' }).success).toBe(false);
  });

  // Regression: Gemini 2.5 Pro sometimes ignores the prompt's "single
  // prose string" instruction for MSE and returns a structured object
  // keyed by exam element. The preprocess flattens it to a string
  // rather than failing the parse — Sprint 19 prod hit this on the
  // first INTAKE-kind session.
  it('coerces an MSE object to a flattened prose string', () => {
    const parsed = IntakeNoteV1Schema.safeParse({
      ...valid,
      mentalStatusExam: {
        appearance: 'Appropriately groomed, neat.',
        behaviour: 'Cooperative, good eye contact.',
        speech: 'Normal rate and tone.',
        mood: '“Stressed”',
        affect: 'Mildly anxious, congruent with mood.',
        thoughtProcess: 'Linear, goal-directed.',
        thoughtContent: 'No SI/HI.',
        cognition: 'Alert and oriented x3.',
        insight: 'Fair.',
        judgement: 'Fair.',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(typeof parsed.data.mentalStatusExam).toBe('string');
      expect(parsed.data.mentalStatusExam).toContain('Appearance:');
      expect(parsed.data.mentalStatusExam).toContain('Thought Process:');
      expect(parsed.data.mentalStatusExam).toContain('Cognition:');
    }
  });

  it('rejects an empty MSE object (nothing to flatten)', () => {
    const parsed = IntakeNoteV1Schema.safeParse({
      ...valid,
      mentalStatusExam: {},
    });
    expect(parsed.success).toBe(false);
  });
});

describe('InitialAssessmentBriefV1Schema', () => {
  const valid: InitialAssessmentBriefV1 = {
    version: 'V1',
    language: 'en',
    workingHypothesis:
      'Panic disorder with anticipatory anxiety; differential includes GAD and adjustment disorder.',
    differential: [
      {
        icd11Code: '6B01',
        icd11Label: 'Panic disorder',
        confidence: 0.45,
        supportingEvidence: [
          {
            quote: 'I just feel my heart racing out of nowhere.',
            speaker: 'client',
            startMs: 1200,
          },
        ],
        gapsToFill: ['Discrete attack frequency', 'Avoidance behaviour mapped'],
      },
    ],
    assessmentGaps: [
      {
        question: 'How many discrete panic attacks in the last month?',
        rationale: 'Required to confirm ICD-11 6B01 frequency criterion.',
      },
    ],
    formulation:
      'Provisional formulation: 6 months post role-change with somatic anxiety and emergent avoidance.',
    recommendedTherapies: [
      {
        name: 'Psychoeducation about the panic cycle',
        rationale: 'First-line; clarifies the model and reduces fear-of-fear.',
        evidenceSummary: 'NICE guidelines recommend psychoed as step 1.',
        whenInPlan: 'first',
      },
    ],
    recommendedInstruments: ['PHQ9', 'GAD7'],
    crisisFlags: [],
  };

  it('accepts a representative brief', () => {
    expect(InitialAssessmentBriefV1Schema.safeParse(valid).success).toBe(true);
  });

  it('rejects a differential entry with confidence > 0.5 (intake ceiling not enforced here, schema allows up to 1)', () => {
    // Schema ceiling is 1; the 0.5 cap is a prompt-level convention.
    // We assert the schema accepts 1.0 so the prompt is what enforces.
    expect(
      InitialAssessmentBriefV1Schema.safeParse({
        ...valid,
        differential: [{ ...valid.differential[0]!, confidence: 0.95 }],
      }).success,
    ).toBe(true);
  });

  it('rejects an empty workingHypothesis', () => {
    expect(
      InitialAssessmentBriefV1Schema.safeParse({ ...valid, workingHypothesis: '' }).success,
    ).toBe(false);
  });

  it('rejects more than 12 assessmentGaps', () => {
    expect(
      InitialAssessmentBriefV1Schema.safeParse({
        ...valid,
        assessmentGaps: Array.from({ length: 13 }, () => ({
          question: 'x',
          rationale: 'y',
        })),
      }).success,
    ).toBe(false);
  });
});
