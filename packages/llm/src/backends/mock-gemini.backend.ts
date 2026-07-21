import {
  type ClinicalReportV1,
  type GeminiCallLogData,
  type InitialAssessmentBriefV1,
  type IPass1Backend,
  type IPass2Backend,
  type IPass3Backend,
  type IPass4Backend,
  type IPass5Backend,
  type IPass6Backend,
  type IPass7Backend,
  type IPass8Backend,
  type IPassCareReportBackend,
  type IPassDifferentialBackend,
  type IPassFindingsBackend,
  type IPassPlanDictationBackend,
  type IPassReasoningBackend,
  type IPassTherapyReasoningBackend,
  type PassTherapyReasoningInput,
  type PassTherapyReasoningOutput,
  type PassCareReportInput,
  type PassCareReportOutput,
  type Pass1Input,
  type Pass1Output,
  type Pass2Input,
  type Pass2Output,
  type Pass3Input,
  type Pass3Output,
  type Pass4Input,
  type Pass4Output,
  type Pass5Input,
  type Pass5Output,
  type Pass6Input,
  type Pass6Output,
  type Pass7Input,
  type Pass7Output,
  type Pass8Input,
  type Pass8Output,
  type PassDifferentialInput,
  type PassDifferentialOutput,
  type PassFindingsInput,
  type PassFindingsOutput,
  type PassPlanDictationInput,
  type PassPlanDictationOutput,
  type PassReasoningInput,
  type PassReasoningOutput,
  type PreSessionBriefV1,
  type TherapyScriptV1,
} from '../types';
import type { CareReportV1, CaseConsultV1 } from '@cureocity/contracts';
import type { ConceptualMapV1 } from '@cureocity/contracts';
import {
  CARE_REPORT_PROMPT_VERSION,
  CASE_BRIEFING_PROMPT_VERSION,
  CLINICAL_ANALYSIS_PROMPT_VERSION,
  CONCEPTUAL_MAP_PROMPT_VERSION,
  PRE_SESSION_BRIEF_PROMPT_VERSION,
  TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION,
  THERAPY_NOTE_PROMPT_VERSION,
  MEDICAL_NOTE_PROMPT_VERSION,
  THERAPY_SCRIPT_PROMPT_VERSION,
  CASE_CONSULT_PROMPT_VERSION,
  DIFFERENTIAL_PROMPT_VERSION,
  FINDINGS_PROMPT_VERSION,
  PLAN_DICTATION_PROMPT_VERSION,
  REASONING_PROMPT_VERSION,
  THERAPY_REASONING_PROMPT_VERSION,
} from '../prompts';

/**
 * Returns deterministic canned responses. Used by tests and by dev
 * environments without GCP credentials. Honest about being a mock:
 * sets model = "mock-flash" / "mock-pro" so call-log analytics can
 * filter out non-production traffic.
 */
export class MockGeminiPass1Backend implements IPass1Backend {
  async run(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    // Pick a deterministic mock based on the spoken-language hint so
    // dev / E2E tests can exercise the code-mixed transcript path.
    // Defaults to a Manglish (Malayalam + English) mix when hints
    // include "ml" — the most common Indian pilot case.
    const hinted = input.hints?.spokenLanguageHints ?? [];
    const manglish = hinted.includes('ml');
    const hinglish = hinted.includes('hi') && !manglish;
    const output: Pass1Output = {
      transcript: manglish
        ? `[mock manglish transcript for session ${input.sessionId} — ${input.durationMs}ms of audio]`
        : hinglish
          ? `[mock hinglish transcript for session ${input.sessionId} — ${input.durationMs}ms of audio]`
          : `[mock transcript for session ${input.sessionId} — ${input.durationMs}ms of audio]`,
      speakerSegments: manglish
        ? [
            {
              speaker: 'therapist',
              startMs: 0,
              endMs: 5_000,
              text: 'Welcome. How have things been since last week?',
              language: 'en',
            },
            {
              speaker: 'client',
              startMs: 5_000,
              endMs: 30_000,
              text: 'കുറച്ച് better aanu. Breathing exercises help cheythu Tuesday-il.',
              language: 'mixed',
            },
          ]
        : hinglish
          ? [
              {
                speaker: 'therapist',
                startMs: 0,
                endMs: 5_000,
                text: 'Welcome. How have things been since last week?',
                language: 'en',
              },
              {
                speaker: 'client',
                startMs: 5_000,
                endMs: 30_000,
                text: 'Thoda better hai. Breathing exercises ne help kiya Tuesday ko.',
                language: 'mixed',
              },
            ]
          : [
              {
                speaker: 'therapist',
                startMs: 0,
                endMs: 5_000,
                text: 'Welcome. How have things been since last week?',
                language: 'en',
              },
              {
                speaker: 'client',
                startMs: 5_000,
                endMs: 30_000,
                text: 'A bit better. The breathing exercises helped on Tuesday.',
                language: 'en',
              },
            ],
      affectFeatures: [
        { startMs: 0, endMs: 30_000, valence: 0.1, arousal: 0.4 },
        { startMs: 30_000, endMs: 60_000, valence: 0.3, arousal: 0.3 },
      ],
      detectedLanguages: manglish ? ['ml', 'en'] : hinglish ? ['hi', 'en'] : ['en'],
    };
    return {
      output,
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
        model: 'mock-flash',
        region: 'mock-asia-south1',
        promptVersion: TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION,
        inputTokens: Math.ceil(input.durationMs / 1000) * 32,
        outputTokens: 200,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

export class MockGeminiPass2Backend implements IPass2Backend {
  async run(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const firstSeg = input.speakerSegments[0];

    // Sprint DV3 — doctors get a medical encounter note (the MEDICAL arm),
    // not a therapy SOAP/intake note. Tagged [mock] like the others.
    if (input.vertical === 'DOCTOR') {
      return {
        output: {
          kind: 'MEDICAL',
          encounterNote: {
            version: 'V1',
            encounterKind: 'NEW_OPD',
            chiefComplaint: '[mock] Exertional chest pressure ×2 days',
            hpi: '[mock] Retrosternal pressure on exertion ×2 days, relieved by rest, no radiation reported; no associated sweating elicited. No prior cardiac history.',
            reviewOfSystems: [
              '[mock] Cardiovascular: exertional chest pressure',
              '[mock] Respiratory: no breathlessness at rest',
            ],
            physicalExam: { examined: false, findings: '' },
            vitals: { bpSystolic: 148, bpDiastolic: 92, heartRateBpm: 88 },
            assessment:
              '[mock] Exertional chest pain — rule out stable angina / ACS. Newly noted hypertension.',
            plan: '[mock] ECG today; aspirin if no contraindication; lipid profile + fasting glucose; review in 3 days with reports.',
            linkedEvidence: firstSeg
              ? [
                  {
                    startMs: firstSeg.startMs,
                    endMs: firstSeg.endMs,
                    quote: firstSeg.text.slice(0, 160),
                  },
                ]
              : [],
          },
          // Sprint DV5 — the finalizer drafts the Rx + clinical orders.
          // Clinically coherent for the chest-pain mock; the deterministic
          // interaction-check runs over these in the orchestrator.
          medications: [
            {
              version: 'V1',
              drug: '[mock] Aspirin',
              form: 'tablet',
              strength: '75 mg',
              dose: '1 tablet',
              route: 'oral',
              frequency: 'once daily',
              durationDays: 30,
              prn: false,
              instructions: 'After food.',
              interactionWarnings: [],
            },
            {
              version: 'V1',
              drug: '[mock] Atorvastatin',
              form: 'tablet',
              strength: '40 mg',
              dose: '1 tablet',
              route: 'oral',
              frequency: 'at night',
              durationDays: 30,
              prn: false,
              instructions: '',
              interactionWarnings: [],
            },
          ],
          orders: [
            {
              version: 'V1',
              category: 'PROCEDURE',
              description: '[mock] 12-lead ECG today',
              rationale: 'Exertional chest pain — screen for ischaemia.',
            },
            {
              version: 'V1',
              category: 'LAB',
              description: '[mock] Fasting lipid profile + fasting glucose',
              rationale: 'Cardiovascular risk stratification.',
            },
          ],
        },
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_2_NOTE_GENERATION',
          model: 'mock-pro',
          region: 'mock-global',
          promptVersion: MEDICAL_NOTE_PROMPT_VERSION,
          inputTokens: input.transcript.length / 4,
          outputTokens: 400,
          costInr: 0,
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    }

    // Sprint 19 — kind branches the output shape.
    const output: Pass2Output =
      input.kind === 'INTAKE'
        ? {
            kind: 'INTAKE',
            intakeNote: {
              version: 'V1',
              presentingConcerns:
                '[mock] Client presents with work-related anxiety, intermittent panic, sleep disturbance.',
              historyOfPresentingIllness:
                '[mock] Onset ~6 months ago following role change. Episodic anxiety attacks 2-3x/week, lasting 10-20 min. Avoidance of meetings developing in last month.',
              pastPsychiatricHistory:
                '[mock] No prior psychiatric history. No prior therapy. Not on psychotropic medication.',
              familyHistory: '[mock] (Not elicited this session.)',
              socialHistory:
                '[mock] Lives with spouse. IT consultant role. Reports moderate alcohol use on weekends. Stable family support.',
              mentalStatusExam:
                '[mock] Appropriately groomed. Cooperative. Speech normal rate + tone. Mood "stressed", affect mildly anxious but congruent. Thought process linear. No SI/HI elicited. Insight + judgement good.',
              workingHypothesis:
                '[mock] Working hypothesis: panic disorder with anticipatory anxiety and developing avoidance. Rule out adjustment disorder + generalised anxiety. Substance use not contributory at present.',
              immediatePlan:
                '[mock] Schedule next session for structured assessment. Administer PHQ-9 + GAD-7 at next visit. Provide psychoeducation handout on panic cycle.',
              // Sprint 72 — when a template is chosen for an intake, echo a
              // mock section per template title so the templated intake view
              // is verifiable in dev (mirrors the treatment mock).
              ...(input.template
                ? {
                    templateSections: input.template.sections.map((s) => ({
                      title: s.title,
                      body: `[mock] ${s.title}: drawn from the intake session for this client.`,
                    })),
                  }
                : {}),
              riskFlags: { severity: 'none', indicators: [] },
              // TS0 — mock notes carry no fabricated provenance.
              linkedEvidence: [],
            },
          }
        : {
            kind: input.kind,
            therapyNote: {
              version: 'V1',
              // Modality fallback for TherapyNoteV1 (required) when
              // null reaches here — orchestrator should have resolved
              // this, but the mock is defensive.
              modality: input.modality ?? 'SUPPORTIVE',
              subjective:
                '[mock] Client reports modest improvement; partial adherence to home practice.',
              objective: '[mock] Mood appears euthymic. Engaged, oriented, appropriate affect.',
              assessment:
                '[mock] Continued progress on anxiety management; address avoidance of work meetings next session.',
              plan: '[mock] Continue thought records; introduce graded exposure hierarchy.',
              summary:
                '[mock] The client reported modest gains in managing anxiety and partial follow-through on home practice. Avoidance of work meetings remains the main obstacle. The plan continues thought records and adds a graded exposure hierarchy.',
              topics: [
                {
                  title: '[mock] Managing anxiety day to day',
                  points: [
                    'Reported feeling calmer than the previous session.',
                    'Used thought records a few times during the week.',
                  ],
                },
                {
                  title: '[mock] Avoidance of work meetings',
                  points: [
                    'Still skips meetings when anxiety spikes.',
                    'Agreed to build a graded exposure plan next session.',
                  ],
                },
              ],
              // Sprint 70 — when a template is chosen, echo a mock section
              // per template title so the templated view is verifiable in dev.
              ...(input.template
                ? {
                    templateSections: input.template.sections.map((s) => ({
                      title: s.title,
                      body: `[mock] ${s.title}: drawn from the session for this client.`,
                    })),
                  }
                : {}),
              riskFlags: { severity: 'none', indicators: [] },
              modalitySpecific: { mock: true },
              // TS0 — mock notes carry no fabricated provenance.
              linkedEvidence: [],
              phaseHints: [
                {
                  phase: 'middle',
                  confidence: 0.75,
                  rationale: 'Therapeutic alliance established',
                },
              ],
            },
          };
    return {
      output,
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_2_NOTE_GENERATION',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: THERAPY_NOTE_PROMPT_VERSION,
        inputTokens: input.transcript.length / 4,
        outputTokens: 400,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Mock Pass 3 (clinical analysis). Deterministic ClinicalReportV1 with
 * representative shape (two diagnosis candidates, gaps, formulation,
 * plan, recommended therapies, no crisis flags). Pulls the first
 * speaker segment as supporting evidence so the citation surface
 * works without a real Gemini call.
 */
export class MockGeminiPass3Backend implements IPass3Backend {
  async run(input: Pass3Input): Promise<{ output: Pass3Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const firstClientSegment = input.speakerSegments.find((s) => s.speaker === 'client') ??
      input.speakerSegments[0] ?? {
        speaker: 'client' as const,
        startMs: 0,
        endMs: 1000,
        text: '(no segments)',
      };
    const supportingQuote = {
      quote: firstClientSegment.text.slice(0, 200),
      speaker: firstClientSegment.speaker,
      startMs: firstClientSegment.startMs,
    };
    // Sprint 19 — branch on kind. Intakes produce an
    // InitialAssessmentBriefV1 with a wider differential and
    // recommended instruments; treatment / review produce the
    // standard ClinicalReportV1.
    let output: Pass3Output;
    if (input.kind === 'INTAKE') {
      const intakeBrief: InitialAssessmentBriefV1 = {
        version: 'V1',
        language: input.language,
        workingHypothesis:
          '[mock] Working hypothesis: panic disorder with anticipatory anxiety and developing avoidance. Differential includes generalised anxiety disorder and adjustment disorder; insufficient duration data to confirm.',
        differential: [
          {
            icd11Code: '6B01',
            icd11Label: 'Panic disorder',
            confidence: 0.45,
            supportingEvidence: [supportingQuote],
            gapsToFill: [
              'Frequency of unexpected panic attacks vs. cued',
              'Avoidance pattern mapped',
              'Duration ≥ 1 month criterion',
            ],
          },
          {
            icd11Code: '6B00',
            icd11Label: 'Generalised anxiety disorder',
            confidence: 0.4,
            supportingEvidence: [supportingQuote],
            gapsToFill: [
              'Duration of worry ≥ 6 months',
              'Excessive worry across multiple domains',
              'Functional impairment',
            ],
          },
          {
            icd11Code: '6B43',
            icd11Label: 'Adjustment disorder',
            confidence: 0.3,
            supportingEvidence: [supportingQuote],
            gapsToFill: ['Identifiable stressor onset', 'Symptoms < 6 months from stressor'],
          },
        ],
        assessmentGaps: [
          {
            question:
              'How many discrete panic attacks in the last month, and were they unexpected?',
            rationale: 'Frequency of unexpected attacks separates panic disorder from GAD.',
            purpose: 'differentiate',
            targets: ['6B01', '6B00'],
          },
          {
            question: 'Did the symptoms start after an identifiable stressor in the last month?',
            rationale:
              'A recent stressor points to adjustment disorder over a primary anxiety disorder.',
            purpose: 'differentiate',
            targets: ['6B01', '6B43'],
          },
          {
            question: 'Has the worry been present most days for ≥ 6 months?',
            rationale: 'Establishes the duration criterion for the leading candidate.',
            purpose: 'confirm',
            targets: ['6B01'],
          },
          {
            question: 'Who is in your life for support day to day?',
            rationale: 'Protective factors shape the safety plan and the treatment plan.',
            purpose: 'context',
            targets: [],
          },
        ],
        formulation:
          '[mock] Provisional formulation: client presents 6 months post role-change with somatic anxiety and emergent avoidance. More data needed on attack frequency + worry duration to distinguish panic disorder from GAD.',
        recommendedTherapies: [
          {
            name: 'Psychoeducation about the panic cycle',
            rationale:
              '[mock] First-line for any anxiety presentation; clarifies the model and reduces fear-of-fear.',
            evidenceSummary:
              'Psychoeducation is recommended as step 1 in NICE guidelines for panic and GAD.',
            whenInPlan: 'first',
          },
          {
            name: 'Cognitive Restructuring',
            rationale:
              '[mock] Targets catastrophic appraisal of bodily sensations driving the panic cycle.',
            evidenceSummary: 'CBT with cognitive restructuring is first-line for panic disorder.',
            whenInPlan: 'after assessment',
          },
        ],
        recommendedInstruments: ['PHQ9', 'GAD7'],
        crisisFlags: [],
      };
      output = { kind: 'INTAKE', initialAssessmentBrief: intakeBrief };
    } else {
      const report: ClinicalReportV1 = {
        version: 'V1',
        language: input.language,
        modality: input.modality ?? 'SUPPORTIVE',
        diagnosisCandidates: [
          {
            icd11Code: '6B00',
            icd11Label: 'Generalised anxiety disorder',
            confidence: 0.55,
            supportingEvidence: [supportingQuote],
            gapsToFill: [
              'Duration of worry over the past 6 months',
              'Functional impairment in work or relationships',
            ],
          },
          {
            icd11Code: '6B01',
            icd11Label: 'Panic disorder',
            confidence: 0.4,
            supportingEvidence: [supportingQuote],
            gapsToFill: ['Frequency of unexpected panic attacks', 'Avoidance behaviour mapped'],
          },
        ],
        primaryDiagnosisIndex: 0,
        assessmentGaps: [
          {
            question: 'Have the panic-like surges been unexpected, or only in feared situations?',
            rationale: 'Unexpected surges favour panic disorder; situational ones favour GAD.',
            purpose: 'differentiate',
            targets: ['6B00', '6B01'],
          },
          {
            question: 'Has the worry been present most days for the last 6 months?',
            rationale: 'Establishes the duration criterion for the leading candidate.',
            purpose: 'confirm',
            targets: ['6B00'],
          },
        ],
        formulation:
          '[mock] Working hypothesis: client presents with persistent worry and somatic arousal triggered by work demands. Predisposing: high baseline conscientiousness. Precipitating: recent role change. Perpetuating: avoidance of meetings. Protective: stable family support.',
        treatmentPlan: {
          modality: 'CBT',
          phaseSequence: [
            'psychoeducation',
            'cognitive restructuring',
            'behavioural activation',
            'exposure',
            'relapse prevention',
          ],
          goals: [
            {
              description: 'Reduce GAD-7 score by 4 points',
              measure: 'GAD-7 administered at session 1 and every 4th session',
              interventions: ['Cognitive restructuring', 'Worry postponement'],
            },
            {
              description: 'Attend one team meeting per week without avoidance',
              measure: 'Self-report log shared at session start',
              interventions: ['Graded exposure'],
            },
          ],
          expectedDurationSessions: 12,
        },
        // Plan-as-diff (R3): on a follow-up (a prior plan exists) the mock
        // proposes a couple of concrete edits so the plan-suggestion UX has
        // something to render offline. First plans emit none.
        planSuggestions: input.clientContext.priorTreatmentPlan
          ? [
              {
                type: 'ADD_GOAL',
                rationale:
                  '[mock] The current goal is nearly met; add a durability goal before consolidation.',
                goal: {
                  description: 'Sustain the gain across two consecutive administrations',
                  measure: 'Screener stays in range at two administrations ≥ 2 weeks apart',
                  interventions: ['Relapse prevention'],
                },
                goalIndex: null,
                expectedDurationSessions: null,
                modality: null,
              },
              {
                type: 'ADJUST_DURATION',
                rationale: '[mock] Progress is ahead of schedule; a shorter course is realistic.',
                goal: null,
                goalIndex: null,
                expectedDurationSessions: 10,
                modality: null,
              },
            ]
          : [],
        // SL1: evidence-anchored updates to the living formulation, so the
        // Close-the-loop surface has something to render offline.
        formulationSuggestions: [
          {
            target: 'PERPETUATING',
            action: 'REVISE',
            text: '[mock] The avoidance link is weakening — activation is holding for a second week.',
            evidenceQuote: 'I actually wanted to go on Thursday, it was not just the plan.',
            cycleRole: null,
          },
          {
            target: 'PROTECTIVE',
            action: 'ADD',
            text: '[mock] Reconnected with a valued social group — add as a protective factor.',
            evidenceQuote: 'They keep texting me to come back on Saturdays.',
            cycleRole: null,
          },
        ],
        recommendedTherapies: [
          {
            name: 'Cognitive Restructuring',
            rationale:
              '[mock] Client describes catastrophic thoughts about being judged in meetings; restructuring targets the cognitive driver.',
            evidenceSummary:
              'Meta-analyses for GAD support CBT with cognitive restructuring as a core component.',
            whenInPlan: 'cognitive restructuring',
          },
          {
            name: 'Graded Exposure (work meetings)',
            rationale:
              '[mock] Avoidance is the chief perpetuating factor; hierarchical exposure reduces it.',
            evidenceSummary:
              'Exposure-based protocols are first-line for anxiety-driven avoidance.',
            whenInPlan: 'exposure',
          },
        ],
        crisisFlags: [],
      };
      output = { kind: input.kind, clinicalReport: report };
    }
    return {
      output,
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_3_CLINICAL_ANALYSIS',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: CLINICAL_ANALYSIS_PROMPT_VERSION,
        inputTokens: Math.ceil(input.transcript.length / 4),
        outputTokens: 600,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Mock Pass 4 (therapy script). Deterministic TherapyScriptV1 with a
 * representative shape: 4 steps with verbatim therapistSays, a couple
 * of branches each, opening + closing + homework + risk watchpoints.
 */
export class MockGeminiPass4Backend implements IPass4Backend {
  async run(input: Pass4Input): Promise<{ output: Pass4Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const script: TherapyScriptV1 = {
      version: 'V1',
      language: input.language,
      therapyName: input.therapyName,
      openingScript:
        '[mock] Hi, good to see you. Today I want us to focus on something we touched on last time — those thoughts that show up when you feel anxious. Sound okay?',
      mainExercise: {
        steps: [
          {
            id: 'orient',
            purpose: 'Orient the client to the technique and get consent.',
            therapistSays:
              "[mock] Today I'm going to teach you a tool called cognitive restructuring. It's a way of catching the unhelpful thoughts that fuel the anxiety and asking some specific questions of them. We'll try it together first, then you'll try one. Sound okay?",
            listenFor:
              "Look for cooperation vs. hesitation. If they seem unsure, slow down and check what's coming up.",
            branches: [
              {
                ifClientSays: "That sounds fine, let's try it",
                thenDo:
                  "[mock] Great. Take a moment and think of a time this week when the anxiety was strong. Don't pick the worst — just one that's recent.",
              },
              {
                ifClientSays: "I don't know if that will work for me",
                thenDo:
                  "[mock] That hesitation makes sense — many people feel that way at first. What's the part that feels unsure?",
              },
            ],
          },
          {
            id: 'elicit-thought',
            purpose: 'Elicit a specific automatic thought from a recent situation.',
            therapistSays:
              '[mock] Picture the moment. Where were you, what were you doing? Now — what was going through your mind? Try to catch the words, not just the feeling.',
            listenFor:
              'A specific cognition, not a feeling. If they say "I felt scared", gently steer to the thought driving the feeling.',
            branches: [
              {
                ifClientSays: "I just felt scared, I don't know what I was thinking",
                thenDo:
                  "[mock] That's common — the thought can be quick. Let me ask differently: if the fear could speak, what would it say?",
              },
            ],
          },
          {
            id: 'examine-evidence',
            purpose: 'Examine evidence for and against the thought.',
            therapistSays:
              "[mock] Okay, so the thought was [restate]. Let's look at it like detectives. What evidence supports this thought? And then — what evidence doesn't support it?",
            listenFor:
              'Whether they can hold both columns. Strong attachment to the thought means more behavioural work is needed first.',
            branches: [
              {
                ifClientSays: 'But it IS true, I really am going to fail',
                thenDo:
                  "[mock] You feel it strongly — that's real. The question isn't whether the thought feels true. It's whether all the evidence points one way. What's ONE piece that doesn't fit the thought?",
              },
            ],
          },
          {
            id: 'reframe',
            purpose: 'Generate a more balanced alternative.',
            therapistSays:
              "[mock] Given everything you said, what's a more balanced way to think about this? Not forced positivity — just what fits the full picture.",
            listenFor: 'A reframe that retains some uncertainty but reduces catastrophising.',
            branches: [],
          },
        ],
      },
      adaptationCues: [
        '[mock] If the client identifies a trauma trigger, pause and stabilise before continuing.',
        '[mock] If the client gets stuck in evidence-for, switch to behavioural experiment design instead.',
      ],
      closingScript:
        "[mock] We did good work today. Notice the thought we examined, and over the week try to catch one more like it and write it down. We'll look at what you find next session.",
      homework: {
        description:
          '[mock] Catch one anxious thought each day. Write it down with the situation, the thought, and the feeling. Bring the notes to next session.',
        deliveryNotes:
          '[mock] Give the client a small notebook or suggest the Notes app on their phone. Confirm they understand by asking them to repeat back the steps.',
      },
      riskWatchpoints: [
        '[mock] Suicidal ideation surfaces — stop the technique and run a safety check.',
        '[mock] Client dissociates or freezes — switch to grounding (5-4-3-2-1).',
      ],
      estimatedDurationMin: 50,
    };
    return {
      output: { therapyScript: script },
      callLog: {
        sessionId: null,
        pass: 'PASS_4_THERAPY_SCRIPT',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: THERAPY_SCRIPT_PROMPT_VERSION,
        inputTokens: Math.ceil(input.therapyName.length / 4) + 200,
        outputTokens: 700,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Mock Pass 5 (pre-session brief). Deterministic PreSessionBriefV1
 * with a coherent shape — context line, recap, focus, opening
 * line, watchpoints. Passes through homework + crisis + instrument
 * data from input so the route layer can exercise the full path
 * in dev/CI without a real Gemini call.
 */
export class MockGeminiPass5Backend implements IPass5Backend {
  async run(input: Pass5Input): Promise<{ output: Pass5Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const modality = input.treatmentPlan?.modality ?? 'CBT';
    const dxLabel = input.primaryDiagnosis?.icd11Label ?? 'presenting concerns';
    const sessionLine =
      input.sessionNumber !== undefined && input.treatmentPlan?.expectedDurationSessions
        ? `Session ${input.sessionNumber} of ${input.treatmentPlan.expectedDurationSessions}`
        : input.sessionNumber !== undefined
          ? `Session ${input.sessionNumber}`
          : 'New session';
    const brief: PreSessionBriefV1 = {
      version: 'V1',
      language: input.language,
      contextLine: `${sessionLine} · ${modality} for ${dxLabel}.`,
      lastSessionRecap: input.lastSessionSummary
        ? `[mock] Last session: ${input.lastSessionSummary.slice(0, 220)}…`
        : '',
      todaysFocus: input.treatmentPlan?.phaseSequence?.length
        ? `[mock] Per plan, today focus on: ${input.treatmentPlan.phaseSequence[0]}. Anchor to the active goal: ${input.treatmentPlan.goals[0]?.description ?? '(see plan)'}.`
        : '[mock] No active plan yet — open with engagement and information gathering.',
      openingLine: input.lastHomework
        ? `"How did the ${input.lastHomework.description.slice(0, 80)} go this week?"`
        : '"Good to see you again. Where would you like to start today?"',
      riskWatchpoints:
        input.openCrises && input.openCrises.length > 0
          ? [
              'Run a safety check before anything else — open crisis flag still on record.',
              '[mock] Re-emergence of avoidance behaviour around the goal context.',
            ]
          : [
              '[mock] Watch for movement on the homework outcome.',
              '[mock] Listen for any new triggers.',
            ],
      homeworkStatus: input.lastHomework
        ? {
            description: input.lastHomework.description,
            outcome:
              (input.lastHomework.outcome as
                | 'completed'
                | 'partial'
                | 'skipped'
                | 'unknown'
                | null) ?? 'unknown',
            notes: null,
          }
        : null,
      carryoverCrisis:
        input.openCrises?.map((c) => ({
          kind: c.kind,
          severity: c.severity,
          lastSeenAt: c.lastSeenAt,
        })) ?? [],
      latestInstruments:
        input.latestInstruments?.map((i) => ({
          instrumentKey: i.instrumentKey,
          score: i.score,
          severity: i.severity,
          administeredAt: i.administeredAt,
        })) ?? [],
    };
    return {
      output: { preSessionBrief: brief },
      callLog: {
        sessionId: null,
        pass: 'PASS_5_PRE_SESSION_BRIEF',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: PRE_SESSION_BRIEF_PROMPT_VERSION,
        inputTokens: 300,
        outputTokens: 250,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Pass 6 mock (Sprint 22). The route passes a fully-formed deterministic
 * briefing as JSON; the mock simply echoes it back (kept as
 * source='deterministic' so dev/CI can tell mock from a real LLM run).
 * This means the case-workspace works end-to-end without GCP.
 */
export class MockGeminiPass6Backend implements IPass6Backend {
  async run(input: Pass6Input): Promise<{ output: Pass6Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const briefing = JSON.parse(input.deterministicBriefingJson);
    return {
      output: { caseBriefing: briefing },
      callLog: {
        sessionId: null,
        pass: 'PASS_6_CASE_BRIEFING',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: CASE_BRIEFING_PROMPT_VERSION,
        inputTokens: Math.ceil(input.contextText.length / 4),
        outputTokens: Math.ceil(input.deterministicBriefingJson.length / 4),
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Pass 7 mock — deterministic 6-node conceptual map. Lets the UI render
 * end-to-end without Vertex creds; nodes are tagged "[mock]" so it's
 * obvious in dev. Edges form a single connected component.
 */
export class MockGeminiPass7Backend implements IPass7Backend {
  async run(input: Pass7Input): Promise<{ output: Pass7Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const map: ConceptualMapV1 = {
      version: 'V1',
      nodes: [
        {
          id: 'n1',
          label: '[mock] Conflicted role',
          category: 'CHALLENGE',
          supportingQuote: 'I keep trying to be everything for everyone and I just feel split.',
          summary: ['Carries multiple incompatible roles', 'Feels fragmented under the weight'],
          description: 'Holds a self-image as the person who must hold it all together.',
          reflectionPrompts: [
            'When does this feel heaviest in your week?',
            'Whose voice tells you it all has to be you?',
          ],
          sourceSessionIds: input.basedOnSessionIds.slice(0, 1),
        },
        {
          id: 'n2',
          label: '[mock] Seeking approval',
          category: 'PATTERN',
          supportingQuote: "I just want him to say I'm doing okay, you know?",
          summary: ['Waits for external validation', 'Defers self-assessment'],
          description: 'Looks outside for permission to feel okay about herself.',
          reflectionPrompts: ['What would change if you were the one to say it first?'],
          sourceSessionIds: input.basedOnSessionIds.slice(0, 1),
        },
        {
          id: 'n3',
          label: '[mock] Honesty',
          category: 'VALUE',
          supportingQuote: 'I have to be honest, even when it costs me.',
          summary: ['Names honesty as a non-negotiable', 'Pays a price for it relationally'],
          description: 'Holds honesty as a core value, even at personal cost.',
          reflectionPrompts: ['Where in your week is honesty hardest?'],
          sourceSessionIds: input.basedOnSessionIds.slice(0, 1),
        },
        {
          id: 'n4',
          label: '[mock] Perfection is necessary',
          category: 'BELIEF',
          supportingQuote: 'If I slip even a bit, everything will fall apart.',
          summary: ['Equates imperfection with collapse', 'High threat sensitivity to mistakes'],
          description: 'Believes a single mistake will cascade into total failure.',
          reflectionPrompts: ['What’s the smallest imperfect thing you can imagine surviving?'],
          sourceSessionIds: input.basedOnSessionIds.slice(0, 1),
        },
        {
          id: 'n5',
          label: '[mock] Quiet capability',
          category: 'AFFIRMATION',
          supportingQuote: 'I figured the whole thing out on my own.',
          summary: ['Self-directed problem solving', 'Resourceful under stress'],
          description: 'Has a demonstrated capacity to handle hard things alone.',
          reflectionPrompts: ['When you handle something well alone, what do you tell yourself?'],
          sourceSessionIds: input.basedOnSessionIds.slice(0, 1),
        },
        {
          id: 'n6',
          label: '[mock] Withdrawing when overwhelmed',
          category: 'PATTERN',
          supportingQuote: 'I just go quiet when it gets too much.',
          summary: ['Shuts down rather than asks for help'],
          description: 'Withdraws when overwhelmed instead of reaching out.',
          reflectionPrompts: ['Who in your life is safe to not be quiet with?'],
          sourceSessionIds: input.basedOnSessionIds.slice(0, 1),
        },
      ],
      edges: [
        {
          from: 'n2',
          to: 'n1',
          relationship: 'Approval-seeking sustains the conflicted-role pattern.',
        },
        {
          from: 'n4',
          to: 'n1',
          relationship: 'The perfection belief amplifies the felt cost of conflicting roles.',
        },
        {
          from: 'n3',
          to: 'n2',
          relationship:
            'Holding honesty as a value creates tension with the approval-seeking pattern.',
        },
        {
          from: 'n6',
          to: 'n1',
          relationship:
            'Withdrawing is the release valve when the role-pressure becomes unbearable.',
        },
        {
          from: 'n5',
          to: 'n4',
          relationship:
            'Quiet capability is the very strength that perfection-belief reframes as never enough.',
        },
      ],
      generatedAt: new Date().toISOString(),
      basedOnSessionIds: input.basedOnSessionIds,
    };
    return {
      output: { conceptualMap: map },
      callLog: {
        sessionId: null,
        pass: 'PASS_7_CONCEPTUAL_MAP',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: CONCEPTUAL_MAP_PROMPT_VERSION,
        inputTokens: Math.ceil(input.contextText.length / 4),
        outputTokens: 600,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Sprint 52 — Pass 8 mock. Deterministic Case Consult — every field
 * tagged `[mock]` so it's obvious in dev. Mirrors the real prompt's
 * structure (situation summary + tried + data + differential +
 * options + supervision questions + India context + disclaimer)
 * without inventing clinical content.
 */
export class MockGeminiPass8Backend implements IPass8Backend {
  async run(input: Pass8Input): Promise<{ output: Pass8Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const consult: CaseConsultV1 = {
      version: 'V1',
      language: input.language,
      situationSummary:
        '[mock] This is a deterministic Case Consult fixture. Set LLM_BACKEND=vertex to see the real consult that grounds in the client record.',
      whatsBeenTried: [
        {
          approach: '[mock] Behavioural activation',
          sessions: 4,
          observedEffect: '[mock] partial engagement; mood slightly improved',
        },
      ],
      whatTheDataShows: [
        '[mock] Journey signals: see the JSON the route passes in for verdicts and next-best-action.',
      ],
      differentialConsiderations: [
        {
          consideration: '[mock] Consider screening for co-occurring anxiety.',
          icd11Code: null,
          evidenceFor: '[mock] residual worry content noted in last 2 sessions',
          evidenceAgainst: '[mock] GAD-7 not yet administered',
        },
      ],
      evidenceBasedOptions: [
        {
          option: '[mock] Add a thought-record practice between sessions.',
          rationale:
            '[mock] BA needs cognitive-restructuring scaffolding once activation is steady.',
          indiaContextNote: null,
        },
      ],
      questionsForSupervision: [
        '[mock] Is the current rate of progress consistent with this presentation?',
      ],
      indiaContextCautions: [
        '[mock] If safety concerns escalate, route to iCall 9152987821 or NIMHANS 080-46110007 alongside escalation.',
      ],
      disclaimer:
        '[mock] This consult is decision-support, not supervision. Clinical responsibility remains with the treating clinician.',
    };
    return {
      output: { caseConsult: consult },
      callLog: {
        sessionId: null,
        pass: 'PASS_8_CASE_CONSULT',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: CASE_CONSULT_PROMPT_VERSION,
        inputTokens: Math.ceil(input.contextText.length / 4),
        outputTokens: 500,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Sprint DV6 — mock differential. Deterministic DifferentialDiagnosisV1
 * tagged `[mock]`, coherent with the chest-pain medical mock (so the
 * doctor live + batch demo works without Vertex). Cites the first
 * speaker segment as supporting evidence.
 */
export class MockGeminiDifferentialBackend implements IPassDifferentialBackend {
  async run(
    input: PassDifferentialInput,
  ): Promise<{ output: PassDifferentialOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const seg = input.speakerSegments[0];
    const evidence = seg
      ? [{ startMs: seg.startMs, endMs: seg.endMs, quote: seg.text.slice(0, 160) }]
      : [];
    const output: PassDifferentialOutput = {
      differential: {
        version: 'V1',
        language: input.language,
        candidates: [
          {
            condition: '[mock] Stable angina (effort-related)',
            icd10Code: 'I20.8',
            likelihood: 0.5,
            supportingEvidence: evidence,
            discriminatingQuestions: [
              'Is the pain reliably brought on by exertion and relieved by rest within minutes?',
              'Any radiation to the arm/jaw, or associated sweating?',
            ],
            suggestedWorkup: [
              'Resting ECG',
              'Troponin if ongoing',
              'Lipid profile',
              'Treadmill test',
            ],
          },
          {
            condition: '[mock] Acute coronary syndrome',
            icd10Code: 'I24.9',
            likelihood: 0.25,
            supportingEvidence: evidence,
            discriminatingQuestions: ['Is the pain present at rest or worsening in frequency?'],
            suggestedWorkup: ['12-lead ECG now', 'Serial troponins'],
          },
          {
            condition: '[mock] Gastro-oesophageal reflux',
            icd10Code: 'K21.9',
            likelihood: 0.15,
            supportingEvidence: [],
            discriminatingQuestions: ['Relation to meals or lying flat? Burning quality?'],
            suggestedWorkup: ['Trial of PPI', 'Review diet history'],
          },
        ],
        redFlagsToExclude: [
          '[mock] Acute coronary syndrome — exclude with ECG + troponin before discharge.',
          '[mock] Aortic dissection if tearing/radiating-to-back pain.',
        ],
        codingNudges: [
          {
            kind: 'DOCUMENTATION_GAP',
            message:
              '[mock] No physical exam documented — record cardiovascular exam to support an I20/I24 code.',
            severity: 'warn',
          },
          {
            kind: 'SUGGESTED_CODE',
            icd10Code: 'I10',
            message: '[mock] BP 148/92 documented — consider coding essential hypertension (I10).',
            severity: 'info',
          },
        ],
        // Sprint DS10-B — the AI-proposed plan the composer offers for
        // adopt/dismiss. Coherent with the chest-pain mock scenario.
        suggestedPlan: {
          investigations: [
            { name: '[mock] 12-lead ECG', rationale: 'exclude ischaemia' },
            { name: '[mock] Troponin', rationale: 'if pain ongoing or recent' },
            { name: '[mock] Lipid profile', rationale: 'risk stratification' },
          ],
          medications: [
            {
              drug: '[mock] Aspirin',
              strength: '75 mg',
              frequency: '0-0-1',
              timing: 'after food',
              durationDays: 30,
              rationale: 'antiplatelet pending cardiology review',
            },
            {
              drug: '[mock] Atorvastatin',
              strength: '40 mg',
              frequency: '0-0-1',
              timing: 'at night',
              durationDays: 30,
              rationale: 'high-intensity statin for suspected CAD',
            },
          ],
          advice: [
            '[mock] Avoid exertion until reviewed.',
            '[mock] Return immediately if pain at rest.',
          ],
          followUp: { when: '[mock] In 3 days', withWhat: 'ECG + troponin reports' },
          examSteps: ['[mock] Cardiovascular examination', '[mock] Blood pressure both arms'],
        },
        disclaimer:
          '[mock] Decision-support only — not a diagnosis. The treating doctor retains clinical responsibility.',
      },
    };
    return {
      output,
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_9_DIFFERENTIAL',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: DIFFERENTIAL_PROMPT_VERSION,
        inputTokens: Math.ceil(input.transcript.length / 4),
        outputTokens: 500,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Sprint DS1 — deterministic findings extractor. Cites the FIRST new
 * utterance's real id (so the gateway citation gate always passes for the
 * mock) and returns a stable canned cardio finding set — including one
 * `negative` — with stable ids (f1/f2/f3) so repeated windows converge
 * (same ids → the CaseState merge replaces, never duplicates). Emits
 * nothing when there are no new utterances.
 */
export class MockGeminiFindingsBackend implements IPassFindingsBackend {
  async run(
    input: PassFindingsInput,
  ): Promise<{ output: PassFindingsOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const anchor = input.newUtterances[0];
    const output: PassFindingsOutput = anchor
      ? {
          findings: [
            {
              id: 'f1',
              kind: 'symptom',
              label: '[mock] exertional chest pressure',
              detail: '×2 days, relieved by rest',
              utteranceIds: [anchor.id],
              polarity: 'present',
            },
            {
              id: 'f2',
              kind: 'negative',
              label: '[mock] no breathlessness at rest',
              utteranceIds: [anchor.id],
              polarity: 'denied',
            },
            {
              id: 'f3',
              kind: 'vital',
              label: '[mock] BP 148/92',
              utteranceIds: [anchor.id],
              polarity: 'present',
            },
          ],
          answeredQuestionIds: [],
        }
      : { findings: [], answeredQuestionIds: [] };

    return {
      output,
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_10_FINDINGS',
        model: 'mock-flash',
        region: 'mock-asia-south1',
        promptVersion: FINDINGS_PROMPT_VERSION,
        inputTokens: input.newUtterances.reduce((n, u) => n + Math.ceil(u.text.length / 4), 0),
        outputTokens: 120,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Sprint DS2 — deterministic reasoning engine. Keyword-routes the utterances
 * to a clinical domain (cardio / endo / GP) and returns a coherent, cited
 * findings-δ + differential + ask-next + red-flag set for that domain. This
 * lets the whole DS2 loop + the eval harness run end-to-end with no creds and
 * gives the unit tests something real to assert. Stable ids (f1/d1/q1 …) so
 * the gateway merge converges; trend flips new→steady once an id was seen.
 */
type MockDomain = 'cardio' | 'endo' | 'gp';

function detectMockDomain(text: string): MockDomain {
  const t = text.toLowerCase();
  if (/thirst|polyuria|urinat|sugar|hba1c|diabet|weight loss|excessive urination/.test(t))
    return 'endo';
  if (/fever|cough|throat|cold|body ache|sore throat|runny nose|sneez/.test(t)) return 'gp';
  if (/chest|angina|pressure|exertion|palpitation|breathless|cardiac|heart/.test(t))
    return 'cardio';
  return 'cardio';
}

/** An open question is "answered" if the new speech mentions its key words. */
function detectMockAnswers(
  newText: string,
  openQuestions: { id: string; question: string }[],
): string[] {
  const hay = newText.toLowerCase();
  const answered: string[] = [];
  for (const q of openQuestions) {
    const keywords = q.question
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
    if (keywords.some((k) => hay.includes(k))) answered.push(q.id);
  }
  return answered;
}

const STOPWORDS = new Set(['about', 'there', 'their', 'would', 'which', 'these', 'those']);

interface MockReasoningTemplate {
  findings: Omit<PassReasoningOutput['findings'][number], 'utteranceIds'>[];
  differential: Omit<PassReasoningOutput['differential'][number], 'trend'>[];
  askNext: PassReasoningOutput['askNext'];
  redFlags: PassReasoningOutput['redFlags'];
  // Sprint DS11.6 — optional exam/order proposals; domains without them
  // surface an empty rail (the builder defaults to []).
  examineNext?: PassReasoningOutput['examineNext'];
  orderNext?: PassReasoningOutput['orderNext'];
}

const MOCK_REASONING: Record<MockDomain, MockReasoningTemplate> = {
  cardio: {
    findings: [
      {
        id: 'f1',
        kind: 'symptom',
        label: '[mock] exertional chest pressure',
        detail: '×2 days, relieved by rest',
        polarity: 'present',
      },
      { id: 'f2', kind: 'negative', label: '[mock] no breathlessness at rest', polarity: 'denied' },
      { id: 'f3', kind: 'vital', label: '[mock] BP 148/92', polarity: 'present' },
    ],
    differential: [
      {
        id: 'd1',
        label: '[mock] Stable angina',
        icd10: 'I20.8',
        likelihood: 'high',
        urgent: false,
        evidenceFor: ['f1', 'f3'],
        evidenceAgainst: [],
        discriminator: 'exercise ECG / relief with rest',
      },
      {
        id: 'd2',
        label: '[mock] Acute coronary syndrome',
        icd10: 'I24.9',
        likelihood: 'moderate',
        urgent: true,
        evidenceFor: ['f1'],
        evidenceAgainst: ['f2'],
        discriminator: 'serial troponin + 12-lead ECG',
      },
      {
        id: 'd3',
        label: '[mock] Gastro-oesophageal reflux',
        icd10: 'K21.9',
        likelihood: 'low',
        urgent: false,
        evidenceFor: ['f1'],
        evidenceAgainst: [],
        discriminator: 'relation to meals / trial of PPI',
      },
    ],
    askNext: [
      {
        id: 'q1',
        question: '[mock] Does the pain radiate to the arm or jaw?',
        why: 'distinguishes ACS from musculoskeletal/GERD',
        targetDxIds: ['d1', 'd2'],
        source: 'DIFFERENTIAL',
        priority: 'high',
        status: 'open',
      },
      {
        id: 'q2',
        question: '[mock] Is the pain related to meals or lying flat?',
        why: 'supports reflux',
        targetDxIds: ['d3'],
        source: 'DIFFERENTIAL',
        priority: 'normal',
        status: 'open',
      },
    ],
    redFlags: [
      {
        label: '[mock] Acute coronary syndrome',
        why: 'exclude with ECG + troponin before discharge',
        findingIds: ['f1'],
      },
    ],
  },
  endo: {
    findings: [
      {
        id: 'f1',
        kind: 'symptom',
        label: '[mock] polyuria + polydipsia',
        detail: '~2 weeks',
        polarity: 'present',
      },
      { id: 'f2', kind: 'symptom', label: '[mock] unintentional weight loss', polarity: 'present' },
      { id: 'f3', kind: 'vital', label: '[mock] random glucose 260 mg/dL', polarity: 'present' },
    ],
    differential: [
      {
        id: 'd1',
        label: '[mock] Type 2 diabetes mellitus',
        icd10: 'E11.9',
        likelihood: 'high',
        urgent: false,
        evidenceFor: ['f1', 'f3'],
        evidenceAgainst: [],
        discriminator: 'HbA1c + fasting glucose',
      },
      {
        id: 'd2',
        label: '[mock] Diabetic ketoacidosis',
        icd10: 'E10.1',
        likelihood: 'moderate',
        urgent: true,
        evidenceFor: ['f3'],
        evidenceAgainst: [],
        discriminator: 'urine/serum ketones + venous gas',
      },
      {
        id: 'd3',
        label: '[mock] Diabetes insipidus',
        icd10: 'E23.2',
        likelihood: 'low',
        urgent: false,
        evidenceFor: ['f1'],
        evidenceAgainst: ['f3'],
        discriminator: 'serum osmolality + water-deprivation test',
      },
    ],
    askNext: [
      {
        id: 'q1',
        question: '[mock] Any nausea, vomiting, or abdominal pain?',
        why: 'screens for DKA',
        targetDxIds: ['d2'],
        source: 'DIFFERENTIAL',
        priority: 'high',
        status: 'open',
      },
      {
        id: 'q2',
        question: '[mock] Any family history of diabetes?',
        why: 'supports type 2 diabetes',
        targetDxIds: ['d1'],
        source: 'DIFFERENTIAL',
        priority: 'normal',
        status: 'open',
      },
    ],
    redFlags: [
      {
        label: '[mock] Diabetic ketoacidosis',
        why: 'check ketones + venous gas if unwell',
        findingIds: ['f3'],
      },
    ],
  },
  gp: {
    findings: [
      { id: 'f1', kind: 'symptom', label: '[mock] fever', detail: '3 days', polarity: 'present' },
      { id: 'f2', kind: 'symptom', label: '[mock] productive cough', polarity: 'present' },
      { id: 'f3', kind: 'negative', label: '[mock] no breathlessness', polarity: 'denied' },
    ],
    differential: [
      {
        id: 'd1',
        label: '[mock] Acute upper respiratory infection',
        icd10: 'J06.9',
        likelihood: 'high',
        urgent: false,
        evidenceFor: ['f1', 'f2'],
        evidenceAgainst: [],
        discriminator: 'self-limiting course / symptomatic',
      },
      {
        id: 'd2',
        label: '[mock] Community-acquired pneumonia',
        icd10: 'J18.9',
        likelihood: 'moderate',
        urgent: false,
        evidenceFor: ['f2'],
        evidenceAgainst: ['f3'],
        discriminator: 'chest exam + SpO2 + chest X-ray',
      },
      {
        id: 'd3',
        label: '[mock] Dengue fever',
        icd10: 'A90',
        likelihood: 'low',
        urgent: false,
        evidenceFor: ['f1'],
        evidenceAgainst: [],
        discriminator: 'NS1/serology + platelet count',
      },
    ],
    askNext: [
      {
        id: 'q1',
        question: '[mock] Any breathlessness or chest pain?',
        why: 'screens for pneumonia',
        targetDxIds: ['d2'],
        source: 'DIFFERENTIAL',
        priority: 'high',
        status: 'open',
      },
      {
        id: 'q2',
        question: '[mock] Any rash, retro-orbital pain, or bleeding?',
        why: 'screens for dengue',
        targetDxIds: ['d3'],
        source: 'DIFFERENTIAL',
        priority: 'normal',
        status: 'open',
      },
    ],
    redFlags: [
      {
        label: '[mock] Community-acquired pneumonia',
        why: 'check SpO2 + chest exam',
        findingIds: ['f2'],
      },
    ],
    // Sprint DS11.6 — exam/order proposals surfaced during the consult.
    examineNext: ['[mock] Throat examination', '[mock] Chest auscultation'],
    orderNext: [
      { name: '[mock] CBC with platelets', rationale: 'monsoon fever — dengue watch' },
      { name: '[mock] Dengue NS1 antigen', rationale: 'day 1-5 of fever' },
    ],
  },
};

export class MockGeminiReasoningBackend implements IPassReasoningBackend {
  async run(
    input: PassReasoningInput,
  ): Promise<{ output: PassReasoningOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const anchor = input.newUtterances[0];
    const newText = input.newUtterances.map((u) => u.text).join(' ');
    const corpus = [newText, ...input.caseState.findings.map((f) => f.label)].join(' ');
    const seenDx = new Set(input.previousDifferential.map((d) => d.id));
    // Sprint DS3 — deterministic auto-resolution: if a new utterance mentions a
    // keyword from an open question, report that question as answered.
    const answeredQuestionIds = detectMockAnswers(newText, input.openQuestions ?? []);

    const output: PassReasoningOutput = anchor
      ? (() => {
          const tpl = MOCK_REASONING[detectMockDomain(corpus)];
          return {
            findings: tpl.findings.map((f) => ({ ...f, utteranceIds: [anchor.id] })),
            answeredQuestionIds,
            differential: tpl.differential.map((d) => ({
              ...d,
              trend: seenDx.has(d.id) ? ('steady' as const) : ('new' as const),
            })),
            askNext: tpl.askNext,
            redFlags: tpl.redFlags,
            examineNext: tpl.examineNext ?? [],
            orderNext: tpl.orderNext ?? [],
          };
        })()
      : {
          findings: [],
          answeredQuestionIds,
          differential: [],
          askNext: [],
          redFlags: [],
          examineNext: [],
          orderNext: [],
        };

    return {
      output,
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_11_REASONING',
        model: 'mock-flash',
        region: 'mock-asia-south1',
        promptVersion: REASONING_PROMPT_VERSION,
        inputTokens: input.newUtterances.reduce((n, u) => n + Math.ceil(u.text.length / 4), 0) + 64,
        outputTokens: 300,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

/**
 * Sprint TS5 — mock therapy reasoning. Keyword-routed over the new client
 * utterances so `LLM_BACKEND=mock` gives a believable live copilot offline:
 * a risk cue when the client says something hopeless/self-harming, a couple of
 * unexplored threads (brother / work / sleep), and one live ask-next. Every
 * item cites the anchor utterance id so the gateway's citation gate keeps it.
 */
export class MockGeminiTherapyReasoningBackend implements IPassTherapyReasoningBackend {
  async run(
    input: PassTherapyReasoningInput,
  ): Promise<{ output: PassTherapyReasoningOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    // In a therapist session the client is stored with speaker 'patient'
    // (the wire Utterance enum is doctor|patient|unknown across verticals).
    const clientUtterances = input.newUtterances.filter((u) => u.speaker === 'patient');
    const anchor = clientUtterances[0] ?? input.newUtterances[0];
    const text = clientUtterances
      .map((u) => u.text)
      .join(' ')
      .toLowerCase();

    const output: PassTherapyReasoningOutput = { riskWatch: [], askNext: [], threads: [] };
    if (anchor) {
      if (/suicid|kill myself|end it|hopeless|worthless|better off dead|ജീവിതം|मरना/.test(text)) {
        output.riskWatch.push({
          id: 'r1',
          label: 'Hopeless / self-harm cue',
          why: 'The client voiced hopelessness — assess ideation, intent and means.',
          severity: 'high',
          source: 'LIVE',
          sourceUtteranceIds: [anchor.id],
        });
      }
      const threads: PassTherapyReasoningOutput['threads'] = [];
      if (/brother|sister|family|father|mother|amma|achan/.test(text)) {
        threads.push({
          id: 't1',
          topic: 'Family conflict',
          note: 'Client named a family relationship in passing without exploring it.',
          mentions: 1,
          sourceUtteranceIds: [anchor.id],
        });
      }
      if (/work|job|office|boss|ജോലി|naukri/.test(text)) {
        threads.push({
          id: 't2',
          topic: 'Work pressure',
          note: 'Work stress mentioned as a trigger; not yet unpacked.',
          mentions: 1,
          sourceUtteranceIds: [anchor.id],
        });
      }
      output.threads = threads.slice(0, 4);
      output.askNext.push({
        id: 'q1',
        question: 'When that feeling shows up, what goes through your mind first?',
        why: 'Opens the thought behind the affect the client just described.',
        source: 'LIVE',
        priority: output.riskWatch.length ? 'high' : 'normal',
        status: 'open',
        sourceUtteranceIds: [anchor.id],
      });
    }

    return {
      output,
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_12_THERAPY_REASONING',
        model: 'mock-flash',
        region: 'mock-asia-south1',
        promptVersion: THERAPY_REASONING_PROMPT_VERSION,
        inputTokens: input.newUtterances.reduce((n, u) => n + Math.ceil(u.text.length / 4), 0) + 48,
        outputTokens: 180,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

export class MockGeminiCareReportBackend implements IPassCareReportBackend {
  async run(
    input: PassCareReportInput,
  ): Promise<{ output: PassCareReportOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const risky = input.transcriptText.includes('[mock-risk]');
    const riskScreen = risky
      ? { level: 'HIGH' as const, evidence: ['[mock] transcript contained the [mock-risk] marker'] }
      : { level: 'NONE' as const, evidence: [] };

    let report: CareReportV1;
    if (input.kind === 'INTAKE') {
      report = {
        kind: 'INTAKE',
        assessmentAndPlan: {
          formulation:
            '[mock] Work pressure and broken sleep are feeding each other. The "I will mess it up" thoughts spike on Sunday nights, and avoiding people keeps the loop going. This makes sense, and it is workable.',
          concernAreas: [
            { name: '[mock] Sleep', evidenceQuote: 'I lie awake till 3 most nights' },
            { name: '[mock] Work worry', evidenceQuote: 'every Sunday I start dreading the week' },
          ],
          measures: [
            { instrumentKey: 'PHQ9', score: 14, band: '[mock] Moderate' },
            { instrumentKey: 'GAD7', score: 11, band: '[mock] Moderate' },
          ],
          provisionalImpression:
            '[mock] What you are describing looks consistent with low mood and worry that has been building around work and sleep. This is a screening-level impression from what you shared, not a formal diagnosis — only a licensed clinician can confirm that.',
          proposedGoals: [
            {
              goal: '[mock] Sleep before 1am, 5 nights a week',
              why: 'broken sleep is feeding the worry loop',
              measure: 'nights per week',
            },
            {
              goal: '[mock] One social thing every week',
              why: 'avoiding people keeps the loop going',
              measure: 'one activity per week',
            },
            {
              goal: '[mock] A toolkit for the Sunday dread',
              why: 'the spike is predictable, so it can be prepared for',
              measure: 'used on 2 Sundays',
            },
          ],
          modalityTrack: 'CBT',
          cadence: 'weekly-25min',
          riskScreen,
        },
      };
    } else if (input.kind === 'REVIEW') {
      let verdicts: CareReportV1extractVerdicts = [];
      try {
        const parsed = input.verdictsJson ? (JSON.parse(input.verdictsJson) as unknown[]) : [];
        verdicts = (parsed as Array<Record<string, unknown>>).map((v) => ({
          instrumentKey: String(v['instrumentKey'] ?? 'PHQ9'),
          baselineScore: Number(v['baselineScore'] ?? 0),
          latestScore: Number(v['latestScore'] ?? 0),
          verdict: String(v['verdict'] ?? 'no_reliable_change'),
          plainWords: '[mock] computed by change-score.ts; explained here in plain words.',
        }));
      } catch {
        verdicts = [];
      }
      report = {
        kind: 'REVIEW',
        progressReview: {
          verdicts,
          goalOutcomes: [
            { goalIndex: 0, status: 'KEEP', note: '[mock] 3 of 5 nights most weeks — keep going' },
            { goalIndex: 1, status: 'ACHIEVED', note: '[mock] cricket on Saturdays stuck' },
          ],
          revisedGoals: [],
          recommendation: 'CONTINUE',
          narrative:
            '[mock] A solid stretch of work. The thought records are landing, sleep is moving, and you showed up every week — that consistency is the treatment.',
          riskScreen,
        },
      };
    } else {
      report = {
        kind: 'TREATMENT',
        sessionReport: {
          headline: '[mock] You caught the thought before it caught you.',
          summary:
            '[mock] You challenged the "I will mess up the review" thought with the actual evidence from Tuesday, and rated it down from 90% to 40% believable. You noticed the word "should" doing a lot of work in your week.',
          insights: [
            {
              observation: '[mock] When work comes up, "should" does too.',
              evidenceQuote:
                'okay when I say it out loud it does sound like a prediction, not a fact',
            },
          ],
          goalProgress: [
            {
              goalIndex: 0,
              movement: 'FORWARD',
              evidence: '[mock] slept before 1am on 3 of 5 nights',
            },
          ],
          homework: {
            title: '[mock] Thought record when the Sunday dread starts',
            steps: [
              'Notice the dread starting',
              'Write the hot thought down',
              'Rate it, answer it, re-rate it',
            ],
            whyItHelps: 'catching the thought early shrinks it before it snowballs',
          },
          reflectionPrompt: '[mock] What would you tell a friend who "made it a thing"?',
          riskScreen,
        },
      };
    }

    return {
      output: { report },
      callLog: {
        sessionId: null,
        pass: 'PASS_13_CARE_REPORT',
        model: 'mock-pro',
        region: 'mock-global',
        promptVersion: CARE_REPORT_PROMPT_VERSION,
        inputTokens: Math.ceil(input.transcriptText.length / 4),
        outputTokens: 450,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

type CareReportV1extractVerdicts = Array<{
  instrumentKey: string;
  baselineScore: number;
  latestScore: number;
  verdict: string;
  plainWords: string;
}>;

/**
 * Sprint DS12 — deterministic plan-dictation mock. Parses the command with a
 * small grammar (add/change/remove med, order/cancel test, advice,
 * follow-up) so the whole voice-edit loop — diff, interaction preview,
 * apply, undo — runs end-to-end in dev with no creds. Drug/test names stay
 * untagged so the interaction engine sees real names; the fallback
 * clarification carries the [mock] tag.
 */
export class MockGeminiPlanDictationBackend implements IPassPlanDictationBackend {
  async run(
    input: PassPlanDictationInput,
  ): Promise<{ output: PassPlanDictationOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const edits: PassPlanDictationOutput['dictation']['edits'] = [];
    const clarifications: string[] = [];

    const clauses = input.command
      .split(/[,;.]| and | aur | then /i)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const clause of clauses) {
      const lower = clause.toLowerCase();
      const strength = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)\b/i.exec(clause);
      const bareNumber = /\b(?:to|se)\s+(\d+(?:\.\d+)?)\b/i.exec(clause);
      const freq = /\b(od|bd|tds|qid|hs|sos|stat)\b/i.exec(clause);
      const night = /at night|raat/i.test(clause);
      const followUp = /follow.?up|review|bulao/i.exec(lower);
      const days = /(\d+)\s*(day|week|hafte|din)/i.exec(lower);

      if (followUp && days?.[1] && days[2]) {
        const n = Number.parseInt(days[1], 10);
        const unit = /week|hafte/i.test(days[2]) ? 'week' : 'day';
        edits.push({ action: 'setFollowUp', when: `In ${n} ${unit}${n === 1 ? '' : 's'}` });
        continue;
      }
      const removeTest =
        /(?:cancel|drop|remove)\s+(?:the\s+)?([a-z][a-z0-9 -]{1,60}?)\s*(?:test)?$/i.exec(clause);
      if (/order|test|karwao|send for/i.test(lower)) {
        const m = /(?:order|send for|karwao)\s+(?:a\s+|an\s+|the\s+)?([a-z][a-z0-9 -]{1,60})/i.exec(
          clause,
        );
        if (m?.[1]) {
          edits.push({ action: 'addInvestigation', name: titleCaseMock(m[1]) });
          continue;
        }
      }
      const removeMed =
        /(?:stop|discontinue|band karo|hata do)\s+(?:the\s+)?([a-z][a-z -]{1,40})/i.exec(clause);
      if (removeMed?.[1]) {
        edits.push({ action: 'removeMed', drug: titleCaseMock(removeMed[1]) });
        continue;
      }
      if (removeTest?.[1]) {
        const target = titleCaseMock(removeTest[1]);
        const onPad = (input.rxPad.meds ?? []).some((x) =>
          x.drug.toLowerCase().includes(target.toLowerCase()),
        );
        edits.push(
          onPad
            ? { action: 'removeMed', drug: target }
            : { action: 'removeInvestigation', name: target },
        );
        continue;
      }
      const change =
        /(?:change|increase|decrease|make|badha do|badal)\s+(?:the\s+)?([a-z][a-z -]{1,40}?)(?:\s+(?:to|se)\b|\s+\d)/i.exec(
          clause,
        );
      const add = /(?:add|start|prescribe|give|de do)\s+([a-z][a-z -]{1,40}?)(?=\s+\d|\s*$)/i.exec(
        clause,
      );
      const medMatch = change ?? add;
      if (medMatch?.[1]) {
        const drug = titleCaseMock(medMatch[1]);
        const fields = {
          ...(strength
            ? { strength: `${strength[1]} ${strength[2]!.toLowerCase()}` }
            : bareNumber
              ? { strength: bareNumber[1]! }
              : {}),
          ...(freq ? { frequency: freq[1]!.toUpperCase() } : night ? { frequency: 'HS' } : {}),
        };
        edits.push(
          change ? { action: 'changeMed', drug, ...fields } : { action: 'addMed', drug, ...fields },
        );
        continue;
      }
      if (/advice|advise|batao/i.test(lower)) {
        edits.push({ action: 'addAdvice', text: clause });
      }
    }

    if (edits.length === 0 && clarifications.length === 0) {
      clarifications.push(
        '[mock] Could not parse that — try “add <drug> <n> mg”, “change <drug> to <n>”, “stop <drug>”, “order <test>”, or “follow up in <n> days”.',
      );
    }

    return {
      output: { dictation: { version: 'V1', edits, clarifications } },
      callLog: {
        sessionId: input.sessionId,
        pass: 'PASS_14_PLAN_DICTATION',
        model: 'mock-flash',
        region: 'mock-asia-south1',
        promptVersion: PLAN_DICTATION_PROMPT_VERSION,
        inputTokens: Math.ceil(input.command.length / 4),
        outputTokens: 80,
        costInr: 0,
        latencyMs: Date.now() - start,
        status: 'SUCCESS',
      },
    };
  }
}

function titleCaseMock(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
