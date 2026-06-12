import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPass8Backend,
  type Pass8Input,
  Pass8OutputSchema,
  type Pass8Output,
} from '../types';
import { CASE_CONSULT_PROMPT_VERSION, CASE_CONSULT_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiProCaseConsultOptions {
  projectId: string;
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Sprint 52 — Pass 8 Case Consult backend. Same SDK + safety-off
 * pattern as Pass 6; uses Pro because the consult is reasoning-heavy
 * and the output is therapist-facing decision support.
 *
 * Errors surface as a typed Pass8BackendError so the route can decide
 * whether to persist a FAILED row or short-circuit; we do NOT have a
 * deterministic fallback for this pass (unlike Pass 6) because the
 * consult is structurally LLM work — the deterministic data is already
 * embedded in `whatTheDataShows` server-side.
 */
export class VertexGeminiProCaseConsultBackend implements IPass8Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiProCaseConsultOptions) {
    this.modelName = opts.model ?? 'gemini-2.5-pro';
    this.region = opts.location ?? 'global';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({ vertexai: true, project: opts.projectId, location: this.region });
  }

  async run(input: Pass8Input): Promise<{ output: Pass8Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: CASE_CONSULT_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 6144,
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
      const parsed: unknown = JSON.parse(text);
      const output = Pass8OutputSchema.parse({ caseConsult: parsed });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: null,
          pass: 'PASS_8_CASE_CONSULT',
          model: this.modelName,
          region: this.region,
          promptVersion: CASE_CONSULT_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new Pass8BackendError((e as Error).message, {
        sessionId: null,
        pass: 'PASS_8_CASE_CONSULT',
        model: this.modelName,
        region: this.region,
        promptVersion: CASE_CONSULT_PROMPT_VERSION,
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

export class Pass8BackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'Pass8BackendError';
  }
}

function buildUserMessage(input: Pass8Input): string {
  return [
    `Output language: ${input.language}`,
    '',
    'Cumulative client record:',
    input.contextText,
    '',
    'Deterministic journey signals (verdicts, next-best-action, adherence):',
    input.journeySignalsJson,
    '',
    'Produce the CaseConsultV1 JSON only.',
  ].join('\n');
}
