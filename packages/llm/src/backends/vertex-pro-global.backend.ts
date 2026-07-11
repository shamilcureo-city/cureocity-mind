import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPass2Backend,
  type Pass2Input,
  Pass2OutputSchema,
  type Pass2Output,
} from '../types';
import {
  INTAKE_NOTE_PROMPT_VERSION,
  INTAKE_NOTE_SYSTEM_PROMPT_V1,
  MEDICAL_NOTE_PROMPT_VERSION,
  MEDICAL_NOTE_SYSTEM_PROMPT_V2,
  THERAPY_NOTE_PROMPT_VERSION,
  THERAPY_NOTE_SYSTEM_PROMPT_V1,
} from '../prompts';
import { computeCostInr, PRO_PRICING, type ModelPricing } from '../pricing';

export interface VertexGeminiProGlobalOptions {
  projectId: string;
  /** Global region — Gemini Pro is not in asia-south1 (see plan § 6.1, gap G13). */
  location?: string;
  model?: string;
  saKeyPath?: string;
  /**
   * Sprint 74 — cost table used for the call log. Defaults to Pro pricing;
   * pass FLASH_PRICING when this backend is constructed with a Flash model
   * (e.g. the live gateway's interim-note pass) so the meter stays honest.
   */
  pricing?: ModelPricing;
  /**
   * Sprint 74 — cap the model's internal "thinking" (billed as output).
   * 0 disables, -1 restores the model's automatic budget, undefined leaves
   * the request unchanged.
   */
  thinkingBudget?: number;
  /** AUD2 — HTTP timeout per attempt (ms). Pass 2 was previously unbounded. */
  timeoutMs?: number;
  /** AUD2 — total attempts incl. the first (transient errors only). */
  maxAttempts?: number;
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
  private readonly pricing: ModelPricing;

  private readonly thinkingBudget: number | undefined;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(opts: VertexGeminiProGlobalOptions) {
    this.thinkingBudget = opts.thinkingBudget;
    this.modelName = opts.model ?? 'gemini-2.5-pro';
    this.region = opts.location ?? 'global';
    this.pricing = opts.pricing ?? PRO_PRICING;
    // AUD2 — a hung Pass 2 used to be bounded only by the platform's function
    // cap, stranding drafts IN_PROGRESS. Mirror the Flash backend: explicit
    // per-attempt timeout + one bounded transient retry.
    this.timeoutMs = opts.timeoutMs ?? 120_000;
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

  async run(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);
    // Sprint 19 / DV3 — vertical + kind drive the prompt + parser branch.
    const isDoctor = input.vertical === 'DOCTOR';
    const isIntake = input.kind === 'INTAKE';
    const systemPrompt = isDoctor
      ? MEDICAL_NOTE_SYSTEM_PROMPT_V2
      : isIntake
        ? INTAKE_NOTE_SYSTEM_PROMPT_V1
        : THERAPY_NOTE_SYSTEM_PROMPT_V1;
    const promptVersion = isDoctor
      ? MEDICAL_NOTE_PROMPT_VERSION
      : isIntake
        ? INTAKE_NOTE_PROMPT_VERSION
        : THERAPY_NOTE_PROMPT_VERSION;

    try {
      const res = await this.callWithRetry({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          temperature: 0.2,
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
      const finishReason = res.candidates?.[0]?.finishReason;
      const blockReason = res.promptFeedback?.blockReason;
      if (!text || text === '{}' || text === '') {
        console.warn(
          `[vertex-pro] sessionId=${input.sessionId} kind=${input.kind} EMPTY response. finishReason=${finishReason} blockReason=${blockReason} textLen=${text?.length ?? 0}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      // Pass 2 prompts ask Gemini to produce the body object directly
      // (no wrapper). Wrap here with the discriminator so downstream
      // consumers see the same shape as the mock backend.
      // Sprint DV5 — the medical prompt returns { encounterNote,
      // medications[], orders[] }. Stay tolerant of a flat note (older
      // shape) by detecting the wrapper key.
      const output: Pass2Output = isDoctor
        ? Pass2OutputSchema.parse(buildMedicalOutput(parsed))
        : isIntake
          ? Pass2OutputSchema.parse({ kind: 'INTAKE', intakeNote: parsed })
          : Pass2OutputSchema.parse({ kind: input.kind, therapyNote: parsed });

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
          promptVersion,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, this.pricing),
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
        promptVersion,
        inputTokens: fallbackTokens,
        outputTokens: 0,
        costInr: computeCostInr(fallbackTokens, 0, this.pricing),
        latencyMs: Date.now() - start,
        status: 'ERROR',
        errorMessage: (e as Error).message,
      });
    }
  }

  /**
   * AUD2 — bounded retry on transient Vertex blips (5xx, DEADLINE_EXCEEDED,
   * UNAVAILABLE, network). Hard rejects surface immediately. Mirrors the
   * Flash backend's pattern.
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
        const backoffMs = 500 * attempt + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Vertex retry exhausted');
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

function isTransientVertexError(e: unknown): boolean {
  const message = (e as { message?: string } | null)?.message ?? '';
  const status = (e as { status?: number } | null)?.status;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  return /DEADLINE_EXCEEDED|UNAVAILABLE|INTERNAL|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(
    message,
  );
}

function buildUserMessage(input: Pass2Input): string {
  // Sprint 70 — when a note template is chosen, list its sections so the
  // model also fills `templateSections` (in addition to the SOAP / intake
  // fields). Sprint 72 — this now applies to INTAKE too: the authoritative
  // eight intake fields are still produced, and the template render is added
  // on top so an intake can be shaped into any chosen format.
  const templateBlock = input.template
    ? [
        '',
        `Note template "${input.template.name}" — also produce templateSections for exactly these titles, in order:`,
        ...input.template.sections.map((s) => `- ${s.title}${s.hint ? ` (${s.hint})` : ''}`),
      ]
    : [];
  return [
    `Session kind: ${input.kind}`,
    `Modality: ${input.modality ?? '(not yet chosen — intake / investigative)'}`,
    `Presenting concerns: ${input.clientContext.presentingConcerns ?? '(none recorded)'}`,
    ...templateBlock,
    '',
    'Transcript (with speaker tags):',
    input.speakerSegments
      .map((s) => `[${s.speaker} ${s.startMs}-${s.endMs}ms] ${s.text}`)
      .join('\n'),
    '',
    input.vertical === 'DOCTOR'
      ? 'Produce { encounterNote, medications[], orders[] } JSON only.'
      : input.kind === 'INTAKE'
        ? 'Produce IntakeNoteV1 JSON only.'
        : 'Produce TherapyNoteV1 JSON only.',
  ].join('\n');
}

/**
 * Sprint DV5 — normalise the medical Pass-2 response to the MEDICAL
 * discriminated-union arm. The V2 prompt returns
 * `{ encounterNote, medications[], orders[] }`; tolerate a flat note
 * (no wrapper) so a model that ignores the envelope still yields a note.
 */
function buildMedicalOutput(parsed: unknown): {
  kind: 'MEDICAL';
  encounterNote: unknown;
  medications: unknown[];
  orders: unknown[];
} {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const hasWrapper = obj && typeof obj === 'object' && 'encounterNote' in obj;
  return {
    kind: 'MEDICAL',
    encounterNote: hasWrapper ? obj['encounterNote'] : parsed,
    medications: hasWrapper && Array.isArray(obj['medications']) ? obj['medications'] : [],
    orders: hasWrapper && Array.isArray(obj['orders']) ? obj['orders'] : [],
  };
}
