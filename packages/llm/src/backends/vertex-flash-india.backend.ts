import { GoogleGenAI } from '@google/genai';
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
 * Ported June 5 2026 from `@google-cloud/vertexai` (the deprecated SDK
 * that hits the v4 OAuth endpoint Google is winding down) to
 * `@google/genai`, the current Google Gen AI SDK that supports both
 * the Gemini API and Vertex AI via a unified surface. The wire
 * payload shape is identical (Content[] with Part[] containing
 * inlineData / text); only the SDK constructor + response accessors
 * changed.
 */
export class VertexGeminiFlashIndiaBackend implements IPass1Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiFlashIndiaOptions) {
    this.modelName = opts.model ?? 'gemini-2.5-flash';
    this.region = opts.location ?? 'asia-south1';
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: opts.projectId,
      location: this.region,
    });
  }

  async run(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const inputTokensEstimate = estimateAudioInputTokens(input.durationMs);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
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
        config: {
          systemInstruction: TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });

      const text = res.text ?? '{}';
      const parsed: unknown = JSON.parse(text);
      const output = Pass1OutputSchema.parse(parsed);

      const usage = res.usageMetadata;
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
