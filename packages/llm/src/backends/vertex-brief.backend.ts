import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPass5Backend,
  type Pass5Input,
  Pass5OutputSchema,
  type Pass5Output,
} from '../types';
import { PRE_SESSION_BRIEF_PROMPT_VERSION, PRE_SESSION_BRIEF_SYSTEM_PROMPT_V1 } from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiProBriefOptions {
  projectId: string;
  location?: string;
  model?: string;
  saKeyPath?: string;
  /**
   * Sprint 74 — cap the model's internal "thinking" (billed as output).
   * 0 disables, -1 restores the model's automatic budget, undefined leaves
   * the request unchanged.
   */
  thinkingBudget?: number;
}

/**
 * Pass 5 backend (Sprint 17): client context → PreSessionBriefV1.
 *
 * Same SDK + region pattern as Pass 2/3/4. Lower max tokens since
 * the brief is intentionally short.
 */
export class VertexGeminiProBriefBackend implements IPass5Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  private readonly thinkingBudget: number | undefined;

  constructor(opts: VertexGeminiProBriefOptions) {
    this.thinkingBudget = opts.thinkingBudget;
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

  async run(input: Pass5Input): Promise<{ output: Pass5Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: PRE_SESSION_BRIEF_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 4096,
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
      if (!text || text === '{}') {
        const finishReason = res.candidates?.[0]?.finishReason;
        const blockReason = res.promptFeedback?.blockReason;
        console.warn(
          `[vertex-brief] clientId=${input.clientId} EMPTY response. finishReason=${finishReason} blockReason=${blockReason}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      const output = Pass5OutputSchema.parse({ preSessionBrief: parsed });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: null,
          pass: 'PASS_5_PRE_SESSION_BRIEF',
          model: this.modelName,
          region: this.region,
          promptVersion: PRE_SESSION_BRIEF_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new Pass5BackendError((e as Error).message, {
        sessionId: null,
        pass: 'PASS_5_PRE_SESSION_BRIEF',
        model: this.modelName,
        region: this.region,
        promptVersion: PRE_SESSION_BRIEF_PROMPT_VERSION,
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

export class Pass5BackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'Pass5BackendError';
  }
}

function buildUserMessage(input: Pass5Input): string {
  const dx = input.primaryDiagnosis
    ? `${input.primaryDiagnosis.icd11Code} ${input.primaryDiagnosis.icd11Label}`
    : '(none confirmed)';
  const plan = input.treatmentPlan
    ? [
        `  Modality: ${input.treatmentPlan.modality}`,
        `  Phase sequence: ${input.treatmentPlan.phaseSequence.join(' → ')}`,
        `  Goals:`,
        ...input.treatmentPlan.goals.map((g) => `    - ${g.description} (measure: ${g.measure})`),
        `  Expected duration: ${input.treatmentPlan.expectedDurationSessions ?? 'n/a'} sessions`,
        ...(input.treatmentPlan.sessionsSoFar !== undefined
          ? [`  Sessions completed so far: ${input.treatmentPlan.sessionsSoFar}`]
          : []),
      ].join('\n')
    : '  (no active plan)';
  const homework = input.lastHomework
    ? `Description: ${input.lastHomework.description}\nOutcome: ${input.lastHomework.outcome ?? 'unknown'}`
    : '(no homework assigned)';
  const crises =
    input.openCrises && input.openCrises.length > 0
      ? input.openCrises
          .map((c) => `  - ${c.kind} (severity ${c.severity}, last seen ${c.lastSeenAt})`)
          .join('\n')
      : '  (none open)';
  const instruments =
    input.latestInstruments && input.latestInstruments.length > 0
      ? input.latestInstruments
          .map(
            (i) => `  - ${i.instrumentKey}: score ${i.score} (${i.severity}, ${i.administeredAt})`,
          )
          .join('\n')
      : '  (none on file)';
  return [
    `Output language: ${input.language}`,
    `Session number: ${input.sessionNumber ?? 'unknown'}`,
    `Primary diagnosis: ${dx}`,
    `Presenting concerns: ${input.presentingConcerns ?? '(none recorded)'}`,
    '',
    'Active treatment plan:',
    plan,
    '',
    `Last session summary: ${input.lastSessionSummary ?? '(first session)'}`,
    '',
    'Last assigned homework:',
    homework,
    '',
    `Last therapy script viewed: ${input.lastTherapyScript ? `${input.lastTherapyScript.therapyName} on ${input.lastTherapyScript.viewedAt}` : '(none)'}`,
    '',
    'Open crisis flags (high/critical):',
    crises,
    '',
    'Latest instrument scores:',
    instruments,
    '',
    'Produce PreSessionBriefV1 JSON only.',
  ].join('\n');
}
