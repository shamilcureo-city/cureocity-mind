import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import {
  type GeminiCallLogData,
  type IPass3Backend,
  type Pass3Input,
  Pass3OutputSchema,
  type Pass3Output,
} from '../types';
import {
  CLINICAL_ANALYSIS_PROMPT_VERSION,
  CLINICAL_ANALYSIS_SYSTEM_PROMPT_V1,
} from '../prompts';
import { computeCostInr, PRO_PRICING } from '../pricing';

export interface VertexGeminiProClinicalOptions {
  projectId: string;
  /** Global region — Pro is not in asia-south1 (same as Pass 2 backend). */
  location?: string;
  model?: string;
  saKeyPath?: string;
}

/**
 * Pass 3 backend (Sprint 13): transcript + TherapyNoteV1 → ClinicalReportV1.
 *
 * Same SDK + region pattern as Pass 2 (Gemini Pro global). The prompt
 * asks for a ClinicalReportV1 object as top-level JSON; the backend
 * wraps it under `clinicalReport` to match Pass3OutputSchema.
 */
export class VertexGeminiProClinicalBackend implements IPass3Backend {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;
  private readonly region: string;

  constructor(opts: VertexGeminiProClinicalOptions) {
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

  async run(input: Pass3Input): Promise<{ output: Pass3Output; callLog: GeminiCallLogData }> {
    const start = Date.now();
    const userMessage = buildUserMessage(input);

    try {
      const res = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: CLINICAL_ANALYSIS_SYSTEM_PROMPT_V1,
          responseMimeType: 'application/json',
          // Lower than Pass 2 because clinical reasoning rewards
          // determinism — the same transcript should not flip
          // diagnosis candidates run to run.
          temperature: 0.15,
          maxOutputTokens: 12_288,
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
          `[vertex-clinical] sessionId=${input.sessionId} EMPTY response. finishReason=${finishReason} blockReason=${blockReason} textLen=${text?.length ?? 0}`,
        );
      }
      const parsed: unknown = JSON.parse(text);
      // Pass3 prompt asks for the ClinicalReportV1 directly (no wrapper).
      // Wrap here so consumers see the same shape as the mock backend.
      const output = Pass3OutputSchema.parse({ clinicalReport: parsed });

      const usage = res.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.ceil(userMessage.length / 4);
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

      return {
        output,
        callLog: {
          sessionId: input.sessionId,
          pass: 'PASS_3_CLINICAL_ANALYSIS',
          model: this.modelName,
          region: this.region,
          promptVersion: CLINICAL_ANALYSIS_PROMPT_VERSION,
          inputTokens,
          outputTokens,
          costInr: computeCostInr(inputTokens, outputTokens, PRO_PRICING),
          latencyMs: Date.now() - start,
          status: 'SUCCESS',
        },
      };
    } catch (e) {
      const fallbackTokens = Math.ceil(userMessage.length / 4);
      throw new Pass3BackendError((e as Error).message, {
        sessionId: input.sessionId,
        pass: 'PASS_3_CLINICAL_ANALYSIS',
        model: this.modelName,
        region: this.region,
        promptVersion: CLINICAL_ANALYSIS_PROMPT_VERSION,
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

export class Pass3BackendError extends Error {
  constructor(
    message: string,
    public readonly callLog: GeminiCallLogData,
  ) {
    super(message);
    this.name = 'Pass3BackendError';
  }
}

function buildUserMessage(input: Pass3Input): string {
  const priorDx =
    input.clientContext.priorDiagnoses && input.clientContext.priorDiagnoses.length > 0
      ? input.clientContext.priorDiagnoses
          .map(
            (d) =>
              `  - ${d.icd11Code} ${d.icd11Label} (confidence ${d.confidence}, primary=${d.isPrimary}, confirmed ${d.confirmedAt})`,
          )
          .join('\n')
      : '  (none on record)';
  const priorPlan = input.clientContext.priorTreatmentPlan
    ? [
        `  Modality: ${input.clientContext.priorTreatmentPlan.modality}`,
        `  Phase sequence: ${input.clientContext.priorTreatmentPlan.phaseSequence.join(' → ')}`,
        `  Goals:`,
        ...input.clientContext.priorTreatmentPlan.goals.map(
          (g) => `    - ${g.description} (measure: ${g.measure})`,
        ),
        `  Expected duration: ${input.clientContext.priorTreatmentPlan.expectedDurationSessions ?? 'n/a'}`,
        `  Version ${input.clientContext.priorTreatmentPlan.version}, confirmed ${input.clientContext.priorTreatmentPlan.confirmedAt}`,
      ].join('\n')
    : '  (no prior treatment plan)';
  return [
    `Output language: ${input.language}`,
    `Modality: ${input.modality}`,
    `Presenting concerns: ${input.clientContext.presentingConcerns ?? '(none recorded)'}`,
    '',
    'Prior confirmed diagnoses:',
    priorDx,
    '',
    'Prior treatment plan:',
    priorPlan,
    '',
    'Transcript (with speaker tags and timestamps in ms):',
    input.speakerSegments
      .map((s) => `[${s.speaker} ${s.startMs}-${s.endMs}ms] ${s.text}`)
      .join('\n'),
    '',
    'TherapyNoteV1 produced for this session:',
    JSON.stringify(input.note, null, 2),
    '',
    'Produce ClinicalReportV1 JSON only.',
  ].join('\n');
}
