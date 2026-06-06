import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
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
      const wavBytes = wrapPcmInWav(input.audioBytes, 16000, 1, 16);
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: wavBytes.toString('base64'),
                },
              },
              {
                text: buildHintsBlock(input.hints),
              },
            ],
          },
        ],
        config: {
          systemInstruction: TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 8192,
          // Therapy content legitimately includes distress, trauma, self-harm
          // mentions, crisis content. Gemini's default BLOCK_MEDIUM_AND_ABOVE
          // silently returns empty candidates for those — observed as
          // transcriptChars=0 with no error and real Vertex cost. Relax to
          // OFF for the scribe pipeline; the clinical surface still gates
          // sensitive content via the riskFlags severity model.
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
          `[vertex-flash] sessionId=${input.sessionId} EMPTY response. finishReason=${finishReason} blockReason=${blockReason} textLen=${text?.length ?? 0}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      const output = Pass1OutputSchema.parse(parsed);
      if (output.transcript.length === 0) {
        console.warn(
          `[vertex-flash] sessionId=${input.sessionId} EMPTY transcript on validated response. finishReason=${finishReason} blockReason=${blockReason} rawTextPreview=${text.slice(0, 300)}`,
        );
      }

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
        output: {
          transcript: '',
          speakerSegments: [],
          affectFeatures: [],
          detectedLanguages: [],
        },
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

function buildHintsBlock(hints: Pass1Input['hints']): string {
  const lines: string[] = [];
  if (hints?.therapistFullName) {
    lines.push(`Therapist's full name (use for diarization bias): ${hints.therapistFullName}`);
  }
  if (hints?.spokenLanguageHints && hints.spokenLanguageHints.length > 0) {
    lines.push(
      `Likely spoken languages (client's preference on file): ${hints.spokenLanguageHints.join(', ')}. Treat as a soft hint; let the actual audio decide.`,
    );
  }
  return lines.length > 0 ? lines.join('\n') : 'No additional hints.';
}

/**
 * Prepend a 44-byte RIFF/WAVE header to raw PCM bytes so Vertex
 * Gemini can decode them. Without this header the model receives
 * undecodable bytes and silently confabulates a plausible-sounding
 * transcript from its training distribution — known failure mode
 * we hit on the first real prod session (jabbar, 2026-06-05).
 *
 * Defaults match the Web Audio capture path (apps/web AudioWorklet
 * polyphase FIR decimation): 16 kHz, mono, 16-bit signed little-endian.
 */
function wrapPcmInWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM = 1
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
