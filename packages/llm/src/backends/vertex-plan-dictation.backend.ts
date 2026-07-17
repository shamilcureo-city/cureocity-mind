import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPassPlanDictationBackend,
  type PassPlanDictationInput,
  PassPlanDictationOutputSchema,
  type PassPlanDictationOutput,
} from '../types';
import { PLAN_DICTATION_PROMPT_VERSION, PLAN_DICTATION_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, FLASH_PRICING } from '../pricing';
import { normalisePlanDictationOutput } from './plan-dictation-normalise';

export interface VertexGeminiPlanDictationOptions {
  projectId: string;
  /** Flash lives in asia-south1 for DPDP residency (the command names the consult's meds). */
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Sprint DS12 — the plan-dictation backend (doctor vertical). The doctor's
 * spoken instruction + the current Rx pad → typed PlanEditCommands.
 * Flash, asia-south1, temperature 0 — this sits in an interactive
 * hold-to-talk loop, so it must be fast and deterministic. The output is
 * proposal-only: a deterministic mapper resolves it against the pad and the
 * doctor approves the diff before anything writes.
 */
export class VertexGeminiPlanDictationBackend implements IPassPlanDictationBackend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiPlanDictationOptions) {
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

  async run(
    input: PassPlanDictationInput,
  ): Promise<{ output: PassPlanDictationOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: PLAN_DICTATION_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 2_048,
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
          `[vertex-plan-dictation] sessionId=${input.sessionId} EMPTY response. finishReason=${finishReason} blockReason=${blockReason} textLen=${text?.length ?? 0}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      const output: PassPlanDictationOutput = PassPlanDictationOutputSchema.parse({
        dictation: normalisePlanDictationOutput(parsed),
      });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_14_PLAN_DICTATION',
          model: this.modelName,
          region: this.region,
          promptVersion: PLAN_DICTATION_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, FLASH_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new PlanDictationBackendError((e as Error).message, {
        sessionId: input.sessionId,
        pass: 'PASS_14_PLAN_DICTATION',
        model: this.modelName,
        region: this.region,
        promptVersion: PLAN_DICTATION_PROMPT_VERSION,
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

export class PlanDictationBackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'PlanDictationBackendError';
  }
}

function buildUserMessage(input: PassPlanDictationInput): string {
  const meds = input.rxPad.meds ?? [];
  const investigations = input.rxPad.investigations ?? [];
  const adviceLines = input.rxPad.adviceLines ?? [];
  return [
    `Output language for clarifications: ${input.language}`,
    '',
    'CURRENT prescription pad:',
    'Medicines:',
    meds.length
      ? meds
          .map((m) =>
            [
              `- ${m.drug}`,
              m.strength,
              m.dose,
              m.frequency,
              m.timing,
              m.durationDays !== undefined ? `${m.durationDays} days` : undefined,
              m.status === 'pending' ? '(pending confirm)' : undefined,
            ]
              .filter(Boolean)
              .join(' · '),
          )
          .join('\n')
      : '(none)',
    'Investigations:',
    investigations.length ? investigations.map((i) => `- ${i.name}`).join('\n') : '(none)',
    'Advice:',
    adviceLines.length ? adviceLines.map((a) => `- ${a}`).join('\n') : '(none)',
    `Follow-up: ${
      input.rxPad.followUp
        ? [input.rxPad.followUp.when, input.rxPad.followUp.withWhat].filter(Boolean).join(' · ')
        : '(none)'
    }`,
    '',
    'The doctor said:',
    `"${input.command}"`,
    '',
    'Produce the { "edits": [...], "clarifications": [...] } JSON only.',
  ].join('\n');
}
