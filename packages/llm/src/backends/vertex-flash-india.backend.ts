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
import { computeCostInr, FLASH_AUDIO_PRICING, estimateAudioInputTokens } from '../pricing';

export interface VertexGeminiFlashIndiaOptions {
  projectId: string;
  /** Always 'asia-south1' for V1 (DPDP residency). */
  location?: string;
  model?: string;
  /** Path to a service-account JSON key, or use ADC if undefined. */
  saKeyPath?: string;
  /**
   * Sprint 57 — HTTP timeout in milliseconds for each Vertex call.
   * Bounded so a stalled call surfaces as a clean error inside the
   * function budget instead of getting reaped by the platform (Vercel
   * Hobby = 60s function cap regardless of maxDuration).
   * Default: 50s — leaves ~10s of headroom for retry + caller overhead.
   */
  timeoutMs?: number;
  /**
   * Sprint 57 — total attempts including the first. One bounded retry
   * (so default 2) turns a transient Vertex 5xx into recovery instead of
   * a user-facing failure. Idempotent + cheap because per-chunk calls
   * are small (~3-5s).
   */
  maxAttempts?: number;
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
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(opts: VertexGeminiFlashIndiaOptions) {
    this.modelName = opts.model ?? 'gemini-2.5-flash';
    this.region = opts.location ?? 'asia-south1';
    this.timeoutMs = opts.timeoutMs ?? 50_000;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: opts.projectId,
      location: this.region,
      httpOptions: { timeout: this.timeoutMs },
    });
  }

  async run(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const inputTokensEstimate = estimateAudioInputTokens(input.durationMs);

    try {
      const wavBytes = wrapPcmInWav(input.audioBytes, 16000, 1, 16);
      const res = await this.callWithRetry({
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
          // A full transcript + per-utterance diarization + affect JSON
          // for a long session easily exceeds 8192 output tokens; hitting
          // the ceiling truncates the JSON → parse throws → empty
          // transcript (silent failure). 65536 is the gemini-2.5-flash
          // output max. Cost is per-token-USED, so a high ceiling is free
          // until the output is actually long (when you want every word).
          maxOutputTokens: 65536,
          // Therapy content legitimately includes distress, trauma, self-harm
          // mentions, crisis content. Gemini's default BLOCK_MEDIUM_AND_ABOVE
          // silently returns empty candidates for those — observed as
          // transcriptChars=0 with no error and real Vertex cost. Relax to
          // OFF for the scribe pipeline; the clinical surface still gates
          // sensitive content via the riskFlags severity model.
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
          costInr: computeCostInr(inputTokens, outputTokens, FLASH_AUDIO_PRICING),
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
          costInr: computeCostInr(inputTokensEstimate, 0, FLASH_AUDIO_PRICING),
          latencyMs: Date.now() - start,
          status: 'ERROR',
          errorMessage: (e as Error).message,
        },
      };
    }
  }

  /**
   * Sprint 57 — bounded retry on a transient Vertex blip. Retries only on
   * what looks transient (5xx, DEADLINE_EXCEEDED, UNAVAILABLE, network).
   * Hard rejects (4xx, INVALID_ARGUMENT, safety blocks) surface immediately
   * so we don't waste budget retrying a request that will never succeed.
   * Total wall time is bounded by the configured timeoutMs × maxAttempts.
   */
  private async callWithRetry(
    req: Parameters<GoogleGenAI['models']['generateContent']>[0],
  ): Promise<Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.ai.models.generateContent(req);
      } catch (e) {
        lastError = e;
        if (attempt >= this.maxAttempts || !isTransientVertexError(e)) {
          throw e;
        }
        // Small jittered backoff. Cheap insurance against a hot retry storm.
        const backoffMs = 400 * attempt + Math.floor(Math.random() * 200);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Vertex retry exhausted');
  }
}

function isTransientVertexError(e: unknown): boolean {
  const message = (e as { message?: string } | null)?.message ?? '';
  const status = (e as { status?: number } | null)?.status;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  return /DEADLINE_EXCEEDED|UNAVAILABLE|INTERNAL|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(
    message,
  );
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
