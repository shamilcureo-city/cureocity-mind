import { describe, expect, it } from 'vitest';
import {
  AssessmentItemKindSchema,
  AssessmentItemSchema,
  AssessmentItemStatusSchema,
  UpdateAssessmentItemInputSchema,
} from './assessment-item';
import { CaseBriefingV1Schema, FivePFormulationSchema } from './case-briefing';

describe('AssessmentItem schemas (Sprint 22)', () => {
  it.each(['OPEN', 'ADDRESSED', 'CLOSED'])('accepts status %s', (s) => {
    expect(AssessmentItemStatusSchema.safeParse(s).success).toBe(true);
  });

  it.each(['DIAGNOSTIC_CRITERION', 'ASSESSMENT_GAP', 'INSTRUMENT', 'SAFETY'])(
    'accepts kind %s',
    (k) => {
      expect(AssessmentItemKindSchema.safeParse(k).success).toBe(true);
    },
  );

  const base = {
    id: 'cabcdefghijklmnopqrstuvwx',
    clientId: 'cclient1111111111111111aa',
    psychologistId: 'cpsy11111111111111111111a',
    episodeId: null,
    kind: 'DIAGNOSTIC_CRITERION' as const,
    question: 'How many discrete panic attacks in the last month?',
    rationale: 'Required for ICD-11 6B01 frequency criterion.',
    icd11Code: '6B01',
    status: 'OPEN' as const,
    sourceSessionId: 'csess1111111111111111111a',
    addressedSessionId: null,
    resolutionNote: null,
    createdAt: '2026-06-07T10:00:00.000Z',
    updatedAt: '2026-06-07T10:00:00.000Z',
    closedAt: null,
  };

  it('accepts an open item', () => {
    expect(AssessmentItemSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a closed item with a resolution note', () => {
    expect(
      AssessmentItemSchema.safeParse({
        ...base,
        status: 'CLOSED',
        addressedSessionId: 'csess2222222222222222222b',
        resolutionNote: '3-4 discrete attacks/week — meets frequency.',
        closedAt: '2026-06-14T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('UpdateAssessmentItemInput accepts status + finding', () => {
    expect(
      UpdateAssessmentItemInputSchema.safeParse({
        status: 'CLOSED',
        resolutionNote: 'Ruled out — onset clearly post-stressor.',
      }).success,
    ).toBe(true);
  });

  it('UpdateAssessmentItemInput rejects a bad status', () => {
    expect(UpdateAssessmentItemInputSchema.safeParse({ status: 'DONE' }).success).toBe(false);
  });
});

describe('CaseBriefingV1 schema (Sprint 22)', () => {
  const formulation = {
    presenting: 'Financial-stressor-related low mood + anxiety.',
    predisposing: 'High-pressure occupation; perfectionistic traits.',
    precipitating: 'Investment losses 6 weeks ago.',
    perpetuating: 'Sleep loss + rumination maintaining the low mood.',
    protective: 'Stable marriage; still enjoys family time.',
  };

  it('accepts the 5 Ps formulation', () => {
    expect(FivePFormulationSchema.safeParse(formulation).success).toBe(true);
  });

  const briefing = {
    version: 'V1' as const,
    headline: 'Adjustment-disorder picture; rule out MDD / GAD over the next 1-2 sessions.',
    formulation,
    workingDiagnosis: {
      icd11Code: '6B43',
      icd11Label: 'Adjustment disorder',
      confidence: 0.5,
      confirmed: false,
    },
    openItems: [
      {
        id: 'citem111111111111111111aa',
        kind: 'DIAGNOSTIC_CRITERION' as const,
        question: 'Symptom-onset timeline vs the stressor?',
        rationale: 'Differentiates Adjustment Disorder from MDD.',
        icd11Code: '6B43',
      },
    ],
    nextActions: [
      {
        title: 'Session 2 — establish the onset timeline',
        detail: 'Open with the question about when the mood shift began relative to the losses.',
        why: 'Closes the Adjustment-Disorder vs MDD differential.',
        when: 'next_session' as const,
        ctaLabel: null,
        ctaHref: null,
      },
    ],
    cadence: {
      recommendedIntervalDays: 7,
      rationale: 'Weekly while symptoms are moderate.',
      reviewDueInSessions: 8,
    },
    safety: {
      highestSeverity: 'none' as const,
      openCrisisFlags: [],
      hasSafetyPlan: false,
    },
    generatedAt: '2026-06-07T10:00:00.000Z',
    source: 'deterministic' as const,
  };

  it('accepts a fully-populated briefing', () => {
    expect(CaseBriefingV1Schema.safeParse(briefing).success).toBe(true);
  });

  it('accepts a null working diagnosis + zero next actions', () => {
    expect(
      CaseBriefingV1Schema.safeParse({
        ...briefing,
        workingDiagnosis: null,
        nextActions: [],
      }).success,
    ).toBe(true);
  });

  it('rejects more than 3 next actions', () => {
    expect(
      CaseBriefingV1Schema.safeParse({
        ...briefing,
        nextActions: Array(4).fill(briefing.nextActions[0]),
      }).success,
    ).toBe(false);
  });

  it('accepts the llm source', () => {
    expect(CaseBriefingV1Schema.safeParse({ ...briefing, source: 'llm' }).success).toBe(true);
  });
});
