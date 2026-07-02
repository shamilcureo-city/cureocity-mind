import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPassReasoningBackend,
  type PassReasoningInput,
  PassReasoningOutputSchema,
  type PassReasoningOutput,
} from '../types';
import { REASONING_PROMPT_VERSION, REASONING_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, FLASH_PRICING } from '../pricing';
import { normaliseReasoningOutput } from './reasoning-normalise';

export interface VertexGeminiReasoningOptions {
  projectId: string;
  /** Flash lives in asia-south1 for DPDP residency (transcript is PII). */
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Sprint DS2 — the live reasoning backend (THE core). CaseState + previous
 * differential + new utterances → findings-δ + ranked differential +
 * ask-next + red flags, in ONE Flash call. asia-south1, temperature 0,
 * structured JSON. Runs per reasoning cycle so it must be fast + cheap. The
 * raw payload is enum-normalised before Zod; the gateway then post-validates
 * citations (drops any dx/red-flag citing a finding id that doesn't exist).
 */
export class VertexGeminiReasoningBackend implements IPassReasoningBackend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiReasoningOptions) {
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
    input: PassReasoningInput,
  ): Promise<{ output: PassReasoningOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: REASONING_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 8_192,
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
      const parsed: unknown = normaliseReasoningOutput(JSON.parse(text));
      const output: PassReasoningOutput = PassReasoningOutputSchema.parse(parsed);

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_11_REASONING',
          model: this.modelName,
          region: this.region,
          promptVersion: REASONING_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, FLASH_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new ReasoningBackendError((e as Error).message, {
        sessionId: input.sessionId,
        pass: 'PASS_11_REASONING',
        model: this.modelName,
        region: this.region,
        promptVersion: REASONING_PROMPT_VERSION,
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

export class ReasoningBackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'ReasoningBackendError';
  }
}

function buildUserMessage(input: PassReasoningInput): string {
  const p = input.caseState.patient;
  return [
    `Output language: ${input.language ?? 'en'}`,
    `Doctor specialty: ${input.specialty ?? '(general)'}`,
    '',
    'Patient context:',
    `- age: ${p.age ?? '(unknown)'}  sex: ${p.sex}`,
    `- known conditions: ${p.knownConditions.join(', ') || '(none recorded)'}`,
    `- active meds: ${p.activeMeds.join(', ') || '(none recorded)'}`,
    `- allergies: ${p.allergies.join(', ') || '(none recorded)'}`,
    '',
    'Findings so far (id · kind · label · polarity):',
    input.caseState.findings.length
      ? input.caseState.findings
          .map(
            (f) =>
              `- ${f.id} · ${f.kind} · ${f.label}${f.detail ? ` (${f.detail})` : ''} · ${f.polarity}`,
          )
          .join('\n')
      : '(none yet)',
    '',
    'Previous differential (id · label · likelihood):',
    input.previousDifferential.length
      ? input.previousDifferential.map((d) => `- ${d.id} · ${d.label} · ${d.likelihood}`).join('\n')
      : '(none yet — this is the first pass)',
    '',
    'Currently-open ask-next questions (id · question) — do NOT repeat these; report any these utterances answer in answeredQuestionIds:',
    input.openQuestions && input.openQuestions.length
      ? input.openQuestions.map((q) => `- ${q.id} · ${q.question}`).join('\n')
      : '(none open)',
    '',
    'NEW utterances since last pass (utteranceId · speaker · text):',
    input.newUtterances.map((u) => `- ${u.id} · ${u.speaker} · ${u.text}`).join('\n'),
    '',
    'Produce PassReasoning JSON only.',
  ].join('\n');
}
