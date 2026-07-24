import { describe, expect, it } from 'vitest';
import {
  ClinicalReportV1Schema,
  InitialAssessmentBriefV1Schema,
  type ClinicalReportV1,
  type InitialAssessmentBriefV1,
} from '@cureocity/contracts';
import { normalisePass3Output } from './pass3-normalise';

// Known-good fixtures copied from the schema specs in
// packages/contracts/src — these parse cleanly today, so any failure in
// the end-to-end tests below is on the normaliser, not the fixture.
const validBrief: InitialAssessmentBriefV1 = {
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
        { quote: 'I just feel my heart racing out of nowhere.', speaker: 'client', startMs: 1200 },
      ],
      gapsToFill: ['Discrete attack frequency'],
    },
  ],
  assessmentGaps: [
    {
      question: 'How many discrete panic attacks in the last month?',
      rationale: 'Required to confirm ICD-11 6B01 frequency criterion.',
      targets: [],
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

const validReport: ClinicalReportV1 = {
  version: 'V1',
  language: 'en',
  modality: 'CBT',
  diagnosisCandidates: [
    {
      icd11Code: '6B00',
      icd11Label: 'Generalised anxiety disorder',
      confidence: 0.6,
      supportingEvidence: [
        { quote: 'I worry about everything every day.', speaker: 'client', startMs: 12_000 },
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
    goals: [
      { description: 'Reduce GAD-7 by 4', measure: 'GAD-7 every 4 sessions', interventions: [] },
    ],
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
  planSuggestions: [],
  formulationSuggestions: [],
};

describe('normalisePass3Output', () => {
  it('returns input unchanged when it has no crisisFlags', () => {
    const input = { foo: 'bar' };
    expect(normalisePass3Output(input)).toEqual(input);
  });

  it('passes through canonical kind + severity unchanged', () => {
    const out = normalisePass3Output({
      crisisFlags: [{ kind: 'suicidal_ideation', severity: 'high' }],
    }) as { crisisFlags: Array<{ kind: string; severity: string }> };
    expect(out.crisisFlags[0]?.kind).toBe('suicidal_ideation');
    expect(out.crisisFlags[0]?.severity).toBe('high');
  });

  it('maps the production drift "suicidal-ideation-risk" → suicidal_ideation', () => {
    const out = normalisePass3Output({
      crisisFlags: [{ kind: 'suicidal-ideation-risk', severity: 'high' }],
    }) as { crisisFlags: Array<{ kind: string; severity: string }> };
    expect(out.crisisFlags[0]?.kind).toBe('suicidal_ideation');
  });

  it('maps the production drift "moderate" → medium', () => {
    const out = normalisePass3Output({
      crisisFlags: [{ kind: 'suicidal_ideation', severity: 'moderate' }],
    }) as { crisisFlags: Array<{ kind: string; severity: string }> };
    expect(out.crisisFlags[0]?.severity).toBe('medium');
  });

  it('case-insensitive on both fields', () => {
    const out = normalisePass3Output({
      crisisFlags: [{ kind: 'Suicidal_Ideation', severity: 'HIGH' }],
    }) as { crisisFlags: Array<{ kind: string; severity: string }> };
    expect(out.crisisFlags[0]?.kind).toBe('suicidal_ideation');
    expect(out.crisisFlags[0]?.severity).toBe('high');
  });

  it('handles common synonyms (overdose, IPV, severe, mild)', () => {
    const out = normalisePass3Output({
      crisisFlags: [
        { kind: 'overdose', severity: 'severe' },
        { kind: 'ipv', severity: 'mild' },
      ],
    }) as { crisisFlags: Array<{ kind: string; severity: string }> };
    expect(out.crisisFlags[0]?.kind).toBe('substance_emergency');
    expect(out.crisisFlags[0]?.severity).toBe('high');
    expect(out.crisisFlags[1]?.kind).toBe('intimate_partner_violence');
    expect(out.crisisFlags[1]?.severity).toBe('low');
  });

  it('CLIN-3: coerces an unknown KIND to "other" but leaves an unknown SEVERITY for Zod', () => {
    const out = normalisePass3Output({
      crisisFlags: [{ kind: 'totally_made_up', severity: 'cataclysmic' }],
    }) as { crisisFlags: Array<{ kind: string; severity: string }> };
    // Unknown kind is salvaged to the catch-all so the report still parses...
    expect(out.crisisFlags[0]?.kind).toBe('other');
    // ...but an unknown severity is left untouched so Zod rejects it — we
    // never fabricate how dangerous a crisis is.
    expect(out.crisisFlags[0]?.severity).toBe('cataclysmic');
  });

  it('does not mutate the input', () => {
    const input = {
      crisisFlags: [{ kind: 'suicidal-ideation-risk', severity: 'moderate' }],
    };
    const snapshot = JSON.stringify(input);
    normalisePass3Output(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('end-to-end: the screenshot-reproduced drift now passes InitialAssessmentBriefV1Schema', () => {
    // Exact failure from production: kind="suicidal-ideation-risk",
    // severity="moderate". After normalisation the strict schema accepts it.
    const drifty = {
      ...validBrief,
      crisisFlags: [
        {
          kind: 'suicidal-ideation-risk',
          severity: 'moderate',
          indicators: [
            {
              quote: 'sometimes I think the world would be better without me',
              speaker: 'client',
              startMs: 45_000,
            },
          ],
          recommendedAction:
            'Stay with client, contact crisis line, schedule follow-up within 24h.',
        },
      ],
    };
    const normalised = normalisePass3Output(drifty);
    const result = InitialAssessmentBriefV1Schema.safeParse(normalised);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crisisFlags[0]?.kind).toBe('suicidal_ideation');
      expect(result.data.crisisFlags[0]?.severity).toBe('medium');
    }
  });

  it('end-to-end: the same fix applies to ClinicalReportV1 (treatment sessions)', () => {
    const drifty = {
      ...validReport,
      crisisFlags: [
        {
          kind: 'overdose',
          severity: 'imminent',
          indicators: [{ quote: 'I have the pills here', speaker: 'client', startMs: 30_000 }],
          recommendedAction: 'Call emergency services immediately.',
        },
      ],
    };
    const normalised = normalisePass3Output(drifty);
    const result = ClinicalReportV1Schema.safeParse(normalised);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crisisFlags[0]?.kind).toBe('substance_emergency');
      expect(result.data.crisisFlags[0]?.severity).toBe('critical');
    }
  });

  it('CLIN-3: coerces an unknown crisis KIND to "other" (keeps severity + indicators)', () => {
    const drifty = {
      ...validReport,
      crisisFlags: [
        {
          kind: 'eating_disorder_emergency', // outside the enum, no synonym
          severity: 'high',
          indicators: [
            { quote: 'I have not eaten in four days', speaker: 'client', startMs: 9000 },
          ],
          recommendedAction: 'Assess medical stability urgently.',
        },
      ],
    };
    const result = ClinicalReportV1Schema.safeParse(normalisePass3Output(drifty));
    expect(result.success).toBe(true);
    if (result.success) {
      // The novel crisis survives instead of sinking the whole report.
      expect(result.data.crisisFlags[0]?.kind).toBe('other');
      // Severity is preserved verbatim — never guessed.
      expect(result.data.crisisFlags[0]?.severity).toBe('high');
      expect(result.data.crisisFlags[0]?.indicators.length).toBe(1);
    }
  });

  it('CLIN-3: still REJECTS an unknown SEVERITY (we never guess how dangerous a crisis is)', () => {
    const drifty = {
      ...validReport,
      crisisFlags: [
        {
          kind: 'suicidal_ideation',
          severity: 'apocalyptic', // unknown severity — must NOT be salvaged
          indicators: [{ quote: 'x', speaker: 'client', startMs: 1 }],
          recommendedAction: 'x',
        },
      ],
    };
    expect(ClinicalReportV1Schema.safeParse(normalisePass3Output(drifty)).success).toBe(false);
  });

  // ==========================================================================
  // Sprint TSC-V2 — assessment-gap purpose normalisation.
  // ==========================================================================

  it('maps a drifted gap purpose synonym to canonical ("differential" → "differentiate")', () => {
    const drifty = {
      ...validReport,
      assessmentGaps: [
        {
          question: 'Any recent stressor?',
          rationale: 'Separates adjustment disorder from a depressive episode.',
          purpose: 'differential', // drift — must map to "differentiate"
          targets: ['6B00', '6B43'],
        },
      ],
    };
    const result = ClinicalReportV1Schema.safeParse(normalisePass3Output(drifty));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assessmentGaps[0]?.purpose).toBe('differentiate');
      expect(result.data.assessmentGaps[0]?.targets).toEqual(['6B00', '6B43']);
    }
  });

  it('DROPS an unrecognised gap purpose rather than sinking the report', () => {
    const drifty = {
      ...validReport,
      assessmentGaps: [
        {
          question: 'What is the overthinking about?',
          rationale: 'Shapes the formulation.',
          purpose: 'vibes', // unknown — must be dropped, gap kept
          targets: [],
        },
      ],
    };
    const result = ClinicalReportV1Schema.safeParse(normalisePass3Output(drifty));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assessmentGaps[0]?.purpose).toBeUndefined();
      expect(result.data.assessmentGaps[0]?.question).toBe('What is the overthinking about?');
    }
  });

  it('filters malformed (non-string) targets so the array-of-string parse survives', () => {
    const drifty = {
      ...validReport,
      assessmentGaps: [
        {
          question: 'When did this start?',
          rationale: 'Timeline separates episode from dysthymia.',
          purpose: 'differentiate',
          targets: ['6A70', { code: '6A72' }, 42], // junk mixed in
        },
      ],
    };
    const result = ClinicalReportV1Schema.safeParse(normalisePass3Output(drifty));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assessmentGaps[0]?.targets).toEqual(['6A70']);
    }
  });
});
