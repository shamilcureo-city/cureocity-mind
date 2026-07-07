import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPassDifferentialBackend,
  type PassDifferentialInput,
  PassDifferentialOutputSchema,
  type PassDifferentialOutput,
} from '../types';
import { DIFFERENTIAL_PROMPT_VERSION, DIFFERENTIAL_SYSTEM_PROMPT_V2 } from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';
import { normaliseDifferentialOutput } from './differential-normalise';

export interface VertexGeminiDifferentialOptions {
  projectId: string;
  /** Global region — Pro is not in asia-south1 (same as Pass 2/3). */
  location?: string;
  model?: string;
  saKeyPath?: string;
  /**
   * Sprint 74 — cap the model's internal "thinking" (billed as output).
   * 0 disables, -1 restores the model's automatic budget, undefined leaves
   * the request unchanged.
   */
  thinkingBudget?: number;
}

/**
 * Sprint DV6 — the differential backend (doctor vertical). Encounter note
 * + transcript → DifferentialDiagnosisV1 (ranked candidates + ICD-10
 * coding nudges). Same SDK + region pattern as Pass 3 (Gemini Pro
 * global). The prompt asks for the body as top-level JSON; the backend
 * wraps it under `differential` to match PassDifferentialOutputSchema.
 */
export class VertexGeminiDifferentialBackend implements IPassDifferentialBackend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  private readonly thinkingBudget: number | undefined;

  constructor(opts: VertexGeminiDifferentialOptions) {
    this.thinkingBudget = opts.thinkingBudget;
    this.modelName = opts.model ?? 'gemini-2.5-pro';
    this.region = opts.location ?? 'global';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: opts.projectId,
      location: this.region,
    });
  }

  async run(
    input: PassDifferentialInput,
  ): Promise<{ output: PassDifferentialOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: DIFFERENTIAL_SYSTEM_PROMPT_V2,
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 12_288,
          ...(this.thinkingBudget !== undefined && {
            thinkingConfig: { thinkingBudget: this.thinkingBudget },
          }),
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.OFF,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.OFF,
            },
          ],
        },
      });

      const text = res.text ?? '{}';
      const finishReason = res.candidates?.[0]?.finishReason;
      const blockReason = res.promptFeedback?.blockReason;
      if (!text || text === '{}' || text === '') {
        console.warn(
          `[vertex-differential] sessionId=${input.sessionId} EMPTY response. finishReason=${finishReason} blockReason=${blockReason} textLen=${text?.length ?? 0}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      const output: PassDifferentialOutput = PassDifferentialOutputSchema.parse({
        differential: normaliseDifferentialOutput(parsed),
      });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_9_DIFFERENTIAL',
          model: this.modelName,
          region: this.region,
          promptVersion: DIFFERENTIAL_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new DifferentialBackendError((e as Error).message, {
        sessionId: input.sessionId,
        pass: 'PASS_9_DIFFERENTIAL',
        model: this.modelName,
        region: this.region,
        promptVersion: DIFFERENTIAL_PROMPT_VERSION,
        inputTokens: fallbackTokens,
        outputTokens: 0,
        costInr: computeCostInr(fallbackTokens, 0, PRO_PRICING),
        latencyMs: Date.now() - start,
        status: 'ERROR',
        errorMessage: (e as Error).message,
      });
    }
  }
}

export class DifferentialBackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'DifferentialBackendError';
  }
}

function buildUserMessage(input: PassDifferentialInput): string {
  return [
    `Output language: ${input.language}`,
    `Doctor specialty: ${input.specialty ?? '(general)'}`,
    '',
    'Structured encounter note:',
    JSON.stringify(input.encounterNote, null, 2),
    '',
    'Transcript (with speaker tags and timestamps in ms):',
    input.speakerSegments
      .map((s) => `[${s.speaker} ${s.startMs}-${s.endMs}ms] ${s.text}`)
      .join('\n'),
    '',
    'Produce DifferentialDiagnosisV1 JSON only.',
  ].join('\n');
}
