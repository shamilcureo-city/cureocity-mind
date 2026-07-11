import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPassCareReportBackend,
  type PassCareReportInput,
  PassCareReportOutputSchema,
  type PassCareReportOutput,
} from '../types';
import {
  buildCareReportUserMessage,
  CARE_REPORT_PROMPT_VERSION,
  CARE_REPORT_SYSTEM_PROMPT_V1,
} from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiCareReportOptions {
  projectId: string;
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Sprint AC4 — Pass 10 Care Report backend. Same SDK + safety-off pattern
 * as Pass 3/8; runs on Vertex like every other REST pass (only the LIVE
 * loop touches AI Studio). Output is CareReportV1 — a discriminated union
 * on `kind`; the produced branch MUST match the requested kind (validated
 * here, not just at the route).
 *
 * Gemini sometimes wraps JSON in markdown fences — stripped before parse.
 */
export class VertexGeminiCareReportBackend implements IPassCareReportBackend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiCareReportOptions) {
    this.modelName = opts.model ?? 'gemini-2.5-pro';
    this.region = opts.location ?? 'global';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({ vertexai: true, project: opts.projectId, location: this.region });
  }

  async run(
    input: PassCareReportInput,
  ): Promise<{ output: PassCareReportOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildCareReportUserMessage({
      kind: input.kind,
      transcriptText: input.transcriptText,
      caseFileJson: input.caseFileJson,
      verdictsJson: input.verdictsJson,
      language: input.language,
    });

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: CARE_REPORT_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.4,
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

      const text = stripMarkdownFences(res.text ?? '{}');
      const parsed: unknown = JSON.parse(text);
      const output = PassCareReportOutputSchema.parse({ report: parsed });
      if (output.report.kind !== input.kind) {
        throw new Error(`Model produced ${output.report.kind} branch for a ${input.kind} session`);
      }

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: null,
          pass: 'PASS_13_CARE_REPORT',
          model: this.modelName,
          region: this.region,
          promptVersion: CARE_REPORT_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new PassCareReportBackendError((e as Error).message, {
        sessionId: null,
        pass: 'PASS_13_CARE_REPORT',
        model: this.modelName,
        region: this.region,
        promptVersion: CARE_REPORT_PROMPT_VERSION,
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

export class PassCareReportBackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'PassCareReportBackendError';
  }
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}
