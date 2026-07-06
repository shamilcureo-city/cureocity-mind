import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPass7Backend,
  type Pass7Input,
  Pass7OutputSchema,
  type Pass7Output,
} from '../types';
import { CONCEPTUAL_MAP_PROMPT_VERSION, CONCEPTUAL_MAP_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiProConceptualMapOptions {
  projectId: string;
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
 * Pass 7 backend (Sprint 24): cumulative client record → ConceptualMapV1.
 * Same SDK + region pattern as Pass 5/6. There's no deterministic
 * fallback because thematic abstraction is the whole point — the route
 * keeps the previous saved map visible if generation fails.
 */
export class VertexGeminiProConceptualMapBackend implements IPass7Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  private readonly thinkingBudget: number | undefined;

  constructor(opts: VertexGeminiProConceptualMapOptions) {
    this.thinkingBudget = opts.thinkingBudget;
    this.modelName = opts.model ?? 'gemini-2.5-pro';
    this.region = opts.location ?? 'global';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({ vertexai: true, project: opts.projectId, location: this.region });
  }

  async run(input: Pass7Input): Promise<{ output: Pass7Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: CONCEPTUAL_MAP_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.35,
          maxOutputTokens: 8192,
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
      const parsedRaw = JSON.parse(text) as Record<string, unknown>;
      // Inject the three server-controlled fields. LLMs frequently
      // skip timestamps + repeat the input session IDs imperfectly,
      // which would fail Zod validation. We own these fields anyway.
      const normalised = {
        ...parsedRaw,
        version: 'V1',
        generatedAt: new Date().toISOString(),
        basedOnSessionIds: input.basedOnSessionIds,
      };
      const output = Pass7OutputSchema.parse({ conceptualMap: normalised });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: null,
          pass: 'PASS_7_CONCEPTUAL_MAP',
          model: this.modelName,
          region: this.region,
          promptVersion: CONCEPTUAL_MAP_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new Pass7BackendError((e as Error).message, {
        sessionId: null,
        pass: 'PASS_7_CONCEPTUAL_MAP',
        model: this.modelName,
        region: this.region,
        promptVersion: CONCEPTUAL_MAP_PROMPT_VERSION,
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

export class Pass7BackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'Pass7BackendError';
  }
}

function buildUserMessage(input: Pass7Input): string {
  return [
    `Output language: ${input.language}`,
    `Session IDs in this context: ${JSON.stringify(input.basedOnSessionIds)}`,
    '',
    'Cumulative client record:',
    input.contextText,
    '',
    'Produce the ConceptualMapV1 JSON only.',
  ].join('\n');
}
