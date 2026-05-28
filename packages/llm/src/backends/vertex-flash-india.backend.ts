import { VertexAI, type GenerativeModel } from '@google-cloud/vertexai';
import {
  type GeminiCallLogData,
  type IPass1Backend,
  type Pass1Input,
  Pass1OutputSchema,
  type Pass1Output,
} from '../types';
import {
  TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION,
  TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1,
} from '../prompts';
import { computeCostInr, FLASH_PRICING, estimateAudioInputTokens } from '../pricing';

export interface VertexGeminiFlashIndiaOptions {
  projectId: string;
  /** Always 'asia-south1' for V1 (DPDP residency). */
  location?: string;
  model?: string;
  /** Path to a service-account JSON key, or use ADC if undefined. */
  saKeyPath?: string;
}

/**
 * Pass 1 backend: audio → transcript + diarization + affect, in asia-south1.
 *
 * NOT VERIFIED end-to-end in CI — runs against real Vertex AI which needs
 * a GCP project with Gemini enabled. Unit tests exercise the request
 * shaping; the actual `generateContent` call is mockable.
 */
export class VertexGeminiFlashIndiaBackend implements IPass1Backend {
  private readonly model: GenerativeModel;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiFlashIndiaOptions) {
    this.modelName = opts.model ?? 'gemini-1.5-flash-002';
    this.region = opts.location ?? 'asia-south1';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    const vertex = new VertexAI({ project: opts.projectId, location: this.region });
    this.model = vertex.getGenerativeModel({
      model: this.modelName,
      systemInstruction: {
        role: 'system',
        parts: [{ text: TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1 }],
      },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    });
  }

  async run(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const inputTokensEstimate = estimateAudioInputTokens(input.durationMs);

    try {
      const res = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: input.audioBytes.toString('base64'),
                },
              },
              {
                text: input.hints?.therapistFullName
                  ? `Therapist's full name (use for diarization bias): ${input.hints.therapistFullName}`
                  : 'No additional hints.',
              },
            ],
          },
        ],
      });

      const text = res.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      const parsed: unknown = JSON.parse(text);
      const output = Pass1OutputSchema.parse(parsed);

      const usage = res.response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? inputTokensEstimate;
      const outputTokens = usage?.candidatesTokenCount ?? 0;

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
          model: this.modelName,
          region: this.region,
          promptVersion: TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, FLASH_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      return {
        output: { transcript: '', speakerSegments: [], affectFeatures: [] },
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
          model: this.modelName,
          region: this.region,
          promptVersion: TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION,
          inputTokens: inputTokensEstimate,
          outputTokens: 0,
          costInr: computeCostInr(inputTokensEstimate, 0, FLASH_PRICING),
          latencyMs: Date.now() - start,
          status: 'ERROR',
          errorMessage: (e as Error).message,
        },
      };
    }
  }
}
