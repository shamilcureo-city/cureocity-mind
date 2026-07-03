import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPassFindingsBackend,
  type PassFindingsInput,
  PassFindingsOutputSchema,
  type PassFindingsOutput,
} from '../types';
import { FINDINGS_PROMPT_VERSION, FINDINGS_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, FLASH_PRICING } from '../pricing';

export interface VertexGeminiFindingsOptions {
  projectId: string;
  /** Flash lives in asia-south1 for DPDP residency (transcript is PII). */
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Sprint DS1 — the findings backend (doctor live copilot). CaseState +
 * new utterances → structured clinical findings. Flash, asia-south1,
 * temperature 0 for determinism, structured JSON output. This runs per
 * transcription window so it must be cheap + fast; it is the substrate the
 * DS2 differential + DS3 ask-next engines cite. It never diagnoses.
 *
 * The gateway applies the citation gate on the returned findings (drops any
 * finding citing an utterance id that doesn't exist) — the backend trusts
 * the prompt but the gateway enforces.
 */
export class VertexGeminiFindingsBackend implements IPassFindingsBackend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiFindingsOptions) {
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
    input: PassFindingsInput,
  ): Promise<{ output: PassFindingsOutput; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: FINDINGS_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 4_096,
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
      const parsed: unknown = JSON.parse(text);
      const output: PassFindingsOutput = PassFindingsOutputSchema.parse(parsed);

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_10_FINDINGS',
          model: this.modelName,
          region: this.region,
          promptVersion: FINDINGS_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, FLASH_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new FindingsBackendError((e as Error).message, {
        sessionId: input.sessionId,
        pass: 'PASS_10_FINDINGS',
        model: this.modelName,
        region: this.region,
        promptVersion: FINDINGS_PROMPT_VERSION,
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

export class FindingsBackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'FindingsBackendError';
  }
}

function buildUserMessage(input: PassFindingsInput): string {
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
    'NEW utterances since last pass (utteranceId · speaker · text):',
    input.newUtterances.map((u) => `- ${u.id} · ${u.speaker} · ${u.text}`).join('\n'),
    '',
    'Produce PassFindings JSON only.',
  ].join('\n');
}
