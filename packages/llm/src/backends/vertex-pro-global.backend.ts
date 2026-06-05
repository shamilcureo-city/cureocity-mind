import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
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
 *
 * Ported June 5 2026 from `@google-cloud/vertexai` (deprecated, removal
 * scheduled June 24 2026) to `@google/genai`. Same prompt + same
 * Pass2OutputSchema validation contract; only the SDK surface changed.
 */
export class VertexGeminiProGlobalBackend implements IPass2Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiProGlobalOptions) {
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

  async run(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: THERAPY_NOTE_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 8192,
          // Same rationale as the Flash backend: therapy notes summarise
          // sensitive content (trauma, crisis flags). Default safety
          // settings would silently empty the response.
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
          ],
        },
      });

      const text = res.text ?? '{}';
      const finishReason = res.candidates?.[0]?.finishReason;
      const blockReason = res.promptFeedback?.blockReason;
      if (!text || text === '{}' || text === '') {
        console.warn(
          `[vertex-pro] sessionId=${input.sessionId} EMPTY response. finishReason=${finishReason} blockReason=${blockReason} textLen=${text?.length ?? 0}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      // The Pass2 prompt asks Gemini to produce a TherapyNoteV1 JSON
      // object directly (no wrapper key) — that matches PRD 22.1 Part
      // 10.3. The Pass2OutputSchema, however, wraps the note under a
      // `therapyNote` key. Wrap here so downstream consumers
      // (orchestrator, NoteDraft) see the same shape as the mock backend.
      const output = Pass2OutputSchema.parse({ therapyNote: parsed });

      const usage = res.usageMetadata;
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
