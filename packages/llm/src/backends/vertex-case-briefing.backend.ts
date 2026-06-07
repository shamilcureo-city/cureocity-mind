import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPass6Backend,
  type Pass6Input,
  Pass6OutputSchema,
  type Pass6Output,
} from '../types';
import { CASE_BRIEFING_PROMPT_VERSION, CASE_BRIEFING_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiProCaseBriefingOptions {
  projectId: string;
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Pass 6 backend (Sprint 22): cumulative client record + deterministic
 * draft → refined CaseBriefingV1. Same SDK + region pattern as Pass 5.
 * The route always has the deterministic fallback if this throws.
 */
export class VertexGeminiProCaseBriefingBackend implements IPass6Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiProCaseBriefingOptions) {
    this.modelName = opts.model ?? 'gemini-2.5-pro';
    this.region = opts.location ?? 'global';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({ vertexai: true, project: opts.projectId, location: this.region });
  }

  async run(input: Pass6Input): Promise<{ output: Pass6Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: CASE_BRIEFING_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.25,
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
      const output = Pass6OutputSchema.parse({ caseBriefing: parsed });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: null,
          pass: 'PASS_6_CASE_BRIEFING',
          model: this.modelName,
          region: this.region,
          promptVersion: CASE_BRIEFING_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new Pass6BackendError((e as Error).message, {
        sessionId: null,
        pass: 'PASS_6_CASE_BRIEFING',
        model: this.modelName,
        region: this.region,
        promptVersion: CASE_BRIEFING_PROMPT_VERSION,
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

export class Pass6BackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'Pass6BackendError';
  }
}

function buildUserMessage(input: Pass6Input): string {
  return [
    `Output language: ${input.language}`,
    '',
    'Cumulative client record:',
    input.contextText,
    '',
    'Deterministic draft briefing (refine this — do not invent facts):',
    input.deterministicBriefingJson,
    '',
    'Produce the refined CaseBriefingV1 JSON only.',
  ].join('\n');
}
