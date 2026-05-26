import { VertexAI, type GenerativeModel } from '@google-cloud/vertexai';
import {
  type GeminiCallLogData,
  type IPass2Backend,
  type Pass2Input,
  Pass2OutputSchema,
  type Pass2Output,
} from '../types';
import { THERAPY_NOTE_PROMPT_VERSION, THERAPY_NOTE_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiProGlobalOptions {
  projectId: string;
  /** Global region — Gemini Pro is not in asia-south1 (see plan § 6.1, gap G13). */
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Pass 2 backend: transcript text → TherapyNoteV1, in the global region.
 * Crosses the India residency boundary; cross-border consent must be
 * collected on the client (`CONSENT_SCOPE_CROSS_BORDER_PROCESSING`) and
 * snapshotted on each Session before this runs.
 */
export class VertexGeminiProGlobalBackend implements IPass2Backend {
  private readonly model: GenerativeModel;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiProGlobalOptions) {
    this.modelName = opts.model ?? 'gemini-1.5-pro-002';
    this.region = opts.location ?? 'us-central1';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    const vertex = new VertexAI({ project: opts.projectId, location: this.region });
    this.model = vertex.getGenerativeModel({
      model: this.modelName,
      systemInstruction: { role: 'system', parts: [{ text: THERAPY_NOTE_SYSTEM_PROMPT_V1 }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    });
  }

  async run(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      });

      const text = res.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      const parsed: unknown = JSON.parse(text);
      const output = Pass2OutputSchema.parse(parsed);

      const usage = res.response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_2_NOTE_GENERATION',
          model: this.modelName,
          region: this.region,
          promptVersion: THERAPY_NOTE_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new Pass2BackendError((e as Error).message, {
        sessionId: input.sessionId,
        pass: 'PASS_2_NOTE_GENERATION',
        model: this.modelName,
        region: this.region,
        promptVersion: THERAPY_NOTE_PROMPT_VERSION,
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

export class Pass2BackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'Pass2BackendError';
  }
}

function buildUserMessage(input: Pass2Input): string {
  return [
    `Modality: ${input.modality}`,
    `Presenting concerns: ${input.clientContext.presentingConcerns ?? '(none recorded)'}`,
    '',
    'Transcript (with speaker tags):',
    input.speakerSegments
      .map((s) => `[${s.speaker} ${s.startMs}-${s.endMs}ms] ${s.text}`)
      .join('\n'),
    '',
    'Produce TherapyNoteV1 JSON only.',
  ].join('\n');
}
