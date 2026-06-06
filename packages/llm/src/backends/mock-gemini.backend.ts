import {
  type ClinicalReportV1,
  type GeminiCallLogData,
  type IPass1Backend,
  type IPass2Backend,
  type IPass3Backend,
  type Pass1Input,
  type Pass1Output,
  type Pass2Input,
  type Pass2Output,
  type Pass3Input,
  type Pass3Output,
  type TherapyNoteV1,
} from '../types';
import {
  CLINICAL_ANALYSIS_PROMPT_VERSION,
  TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION,
  THERAPY_NOTE_PROMPT_VERSION,
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
    const output: Pass1Output = {
      transcript: `[mock transcript for session ${input.sessionId} — ${input.durationMs}ms of audio]`,
      speakerSegments: [
        {
          speaker: 'therapist',
          startMs: 0,
          endMs: 5_000,
          text: 'Welcome. How have things been since last week?',
        },
        {
          speaker: 'client',
          startMs: 5_000,
          endMs: 30_000,
          text: 'A bit better. The breathing exercises helped on Tuesday.',
        },
      ],
      affectFeatures: [
        { startMs: 0, endMs: 30_000, valence: 0.1, arousal: 0.4 },
        { startMs: 30_000, endMs: 60_000, valence: 0.3, arousal: 0.3 },
      ],
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
    const note: TherapyNoteV1 = {
      version: 'V1',
      modality: input.modality,
      subjective: '[mock] Client reports modest improvement; partial adherence to home practice.',
      objective: '[mock] Mood appears euthymic. Engaged, oriented, appropriate affect.',
      assessment:
        '[mock] Continued progress on anxiety management; address avoidance of work meetings next session.',
      plan: '[mock] Continue thought records; introduce graded exposure hierarchy.',
      riskFlags: { severity: 'none', indicators: [] },
      modalitySpecific: { mock: true },
      phaseHints: [
        { phase: 'middle', confidence: 0.75, rationale: 'Therapeutic alliance established' },
      ],
    };
    return {
      output: { therapyNote: note },
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
    const report: ClinicalReportV1 = {
      version: 'V1',
      language: input.language,
      modality: input.modality,
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
          question: 'Has the worry been present most days for the last 6 months?',
          rationale: 'Required to meet ICD-11 6B00 duration criterion.',
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
          },
          {
            description: 'Attend one team meeting per week without avoidance',
            measure: 'Self-report log shared at session start',
          },
        ],
        expectedDurationSessions: 12,
      },
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
          evidenceSummary: 'Exposure-based protocols are first-line for anxiety-driven avoidance.',
          whenInPlan: 'exposure',
        },
      ],
      crisisFlags: [],
    };
    return {
      output: { clinicalReport: report },
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
