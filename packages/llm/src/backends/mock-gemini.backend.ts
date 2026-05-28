import {
  type GeminiCallLogData,
  type IPass1Backend,
  type IPass2Backend,
  type Pass1Input,
  type Pass1Output,
  type Pass2Input,
  type Pass2Output,
  type TherapyNoteV1,
} from '../types';
import { TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION, THERAPY_NOTE_PROMPT_VERSION } from '../prompts';

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
