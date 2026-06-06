import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPass4Backend,
  type Pass4Input,
  Pass4OutputSchema,
  type Pass4Output,
} from '../types';
import {
  THERAPY_SCRIPT_PROMPT_VERSION,
  THERAPY_SCRIPT_SYSTEM_PROMPT_V1,
} from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiProTherapyScriptOptions {
  projectId: string;
  /** Global region — Pro is not in asia-south1 (same as Pass 2/3 backend). */
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Pass 4 backend (Sprint 14): therapy name + diagnosis + plan + history
 * → TherapyScriptV1.
 *
 * Same SDK + region pattern as Pass 2/3 (Gemini Pro global). The
 * prompt asks for a TherapyScriptV1 object as top-level JSON; the
 * backend wraps it under `therapyScript` to match Pass4OutputSchema.
 */
export class VertexGeminiProTherapyScriptBackend implements IPass4Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiProTherapyScriptOptions) {
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

  async run(input: Pass4Input): Promise<{ output: Pass4Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: THERAPY_SCRIPT_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          // A bit higher than Pass 3 — verbatim language for a script
          // benefits from some natural variation step to step. Still
          // low enough to keep the structure stable.
          temperature: 0.35,
          maxOutputTokens: 10_240,
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
          `[vertex-therapy-script] therapy=${input.therapyName} EMPTY response. finishReason=${finishReason} blockReason=${blockReason} textLen=${text?.length ?? 0}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      const output = Pass4OutputSchema.parse({ therapyScript: parsed });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: null,
          pass: 'PASS_4_THERAPY_SCRIPT',
          model: this.modelName,
          region: this.region,
          promptVersion: THERAPY_SCRIPT_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new Pass4BackendError((e as Error).message, {
        sessionId: null,
        pass: 'PASS_4_THERAPY_SCRIPT',
        model: this.modelName,
        region: this.region,
        promptVersion: THERAPY_SCRIPT_PROMPT_VERSION,
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

export class Pass4BackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'Pass4BackendError';
  }
}

function buildUserMessage(input: Pass4Input): string {
  const dx = input.primaryDiagnosis
    ? `${input.primaryDiagnosis.icd11Code} ${input.primaryDiagnosis.icd11Label}`
    : '(none confirmed)';
  const plan = input.treatmentPlan
    ? [
        `  Modality: ${input.treatmentPlan.modality}`,
        `  Phase sequence: ${input.treatmentPlan.phaseSequence.join(' → ')}`,
        `  Goals:`,
        ...input.treatmentPlan.goals.map(
          (g) => `    - ${g.description} (measure: ${g.measure})`,
        ),
        `  Expected duration: ${input.treatmentPlan.expectedDurationSessions ?? 'n/a'} sessions`,
      ].join('\n')
    : '  (no plan)';
  const spoken = input.spokenLanguage ?? input.language;
  return [
    `Therapy name: ${input.therapyName}`,
    `Output language: ${input.language}`,
    `Spoken language: ${spoken}`,
    `Primary diagnosis: ${dx}`,
    `Presenting concerns: ${input.presentingConcerns ?? '(none recorded)'}`,
    '',
    'Active treatment plan:',
    plan,
    '',
    `Last session summary: ${input.lastSessionSummary ?? '(first session in this plan)'}`,
    '',
    'Produce TherapyScriptV1 JSON only.',
  ].join('\n');
}
