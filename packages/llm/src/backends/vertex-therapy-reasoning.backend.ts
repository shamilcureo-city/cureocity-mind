import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPassTherapyReasoningBackend,
  type PassTherapyReasoningInput,
  PassTherapyReasoningOutputSchema,
  type PassTherapyReasoningOutput,
} from '../types';
import { THERAPY_REASONING_PROMPT_VERSION, THERAPY_REASONING_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, FLASH_PRICING } from '../pricing';
import { normaliseTherapyReasoningOutput } from './therapy-reasoning-normalise';

export interface VertexGeminiTherapyReasoningOptions {
  projectId: string;
  /** Flash lives in asia-south1 for DPDP residency (transcript is PII). */
  location?: string;
  model?: string;
  saKeyPath?: string;
  /** Cap the model's internal thinking — this pass is latency-critical. */
  thinkingBudget?: number;
}

/**
 * Sprint TS5 — the live therapy reasoning backend. New utterances (+ a recent
 * tail + planned questions + prior-risk flag) → risk cues + live ask-next +
 * unexplored threads, in ONE Flash call. asia-south1, temperature 0,
 * structured JSON. The raw payload is normalised before Zod; the gateway then
 * post-validates citations (drops any item citing an utterance id that isn't
 * real). Modelled on VertexGeminiReasoningBackend.
 */
export class VertexGeminiTherapyReasoningBackend implements IPassTherapyReasoningBackend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;
  private readonly thinkingBudget: number | undefined;

  constructor(opts: VertexGeminiTherapyReasoningOptions) {
    this.modelName = opts.model ?? 'gemini-2.5-flash';
    this.region = opts.location ?? 'asia-south1';
    this.thinkingBudget = opts.thinkingBudget;
    if (opts.saKeyPath) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = opts.saKeyPath;
    }
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: opts.projectId,
      location: this.region,
    });
  }

  async run(
    input: PassTherapyReasoningInput,
  ): Promise<{ output: PassTherapyReasoningOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: THERAPY_REASONING_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 4_096,
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
      const parsed: unknown = normaliseTherapyReasoningOutput(JSON.parse(text));
      const output: PassTherapyReasoningOutput = PassTherapyReasoningOutputSchema.parse(parsed);

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_12_THERAPY_REASONING',
          model: this.modelName,
          region: this.region,
          promptVersion: THERAPY_REASONING_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, FLASH_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new TherapyReasoningBackendError((e as Error).message, {
        sessionId: input.sessionId,
        pass: 'PASS_12_THERAPY_REASONING',
        model: this.modelName,
        region: this.region,
        promptVersion: THERAPY_REASONING_PROMPT_VERSION,
        inputTokens: fallbackTokens,
        outputTokens: 0,
        costInr: computeCostInr(fallbackTokens, 0, FLASH_PRICING),
        latencyMs: Date.now() - start,
        status: 'ERROR',
        errorMessage: (e as Error).message,
      });
    }
  }
}

export class TherapyReasoningBackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'TherapyReasoningBackendError';
  }
}

function buildUserMessage(input: PassTherapyReasoningInput): string {
  return [
    `Output language: ${input.language ?? 'en'}`,
    `Prior suicidal ideation on file: ${input.priorRisk ? 'YES — stay sensitive to risk cues' : 'no'}`,
    '',
    'Questions the therapist PLANNED for this session (context only — do NOT restate as askNext):',
    input.carriedQuestions.length
      ? input.carriedQuestions
          .map((q) => `- ${q.question}${q.why ? ` (why: ${q.why})` : ''}`)
          .join('\n')
      : '(none planned)',
    '',
    'Threads already surfaced (id · topic) — bump or extend, do not duplicate:',
    input.previousThreads && input.previousThreads.length
      ? input.previousThreads.map((t) => `- ${t.id} · ${t.topic}`).join('\n')
      : '(none yet)',
    '',
    'Currently-open LIVE ask-next questions (id · question) — do NOT repeat:',
    input.openQuestions && input.openQuestions.length
      ? input.openQuestions.map((q) => `- ${q.id} · ${q.question}`).join('\n')
      : '(none open)',
    '',
    'RECENT earlier utterances (context; utteranceId · speaker · text):',
    input.recentUtterances.length
      ? input.recentUtterances.map((u) => `- ${u.id} · ${u.speaker} · ${u.text}`).join('\n')
      : '(none)',
    '',
    'NEW utterances since last pass (utteranceId · speaker · text):',
    input.newUtterances.map((u) => `- ${u.id} · ${u.speaker} · ${u.text}`).join('\n'),
    '',
    'Produce the therapy-reasoning JSON only.',
  ].join('\n');
}
