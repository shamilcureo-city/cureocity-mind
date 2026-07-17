import { Prisma } from '@prisma/client';
import type { PlanDictationV1, RxPadDraft } from '@cureocity/contracts';
import {
  computeCostInr,
  FLASH_PRICING,
  type ClinicalLocale,
  type GeminiCallLogData,
} from '@cureocity/llm';
import { recordCostInr, recordGeminiCall } from '@cureocity/observability/metrics';
import { writeAudit } from './audit';
import { checkCostCircuit } from './cost-guard';
import { modelRouter } from './llm';
import { prisma } from './prisma';

/**
 * Sprint DS12 — run the plan-dictation passes for one spoken instruction.
 *
 * Proposal-only: NOTHING here writes to the pad. The route maps the returned
 * commands onto RxPadPatchOps via @cureocity/clinical's proposePlanEdits and
 * the doctor's Apply tap goes through the existing audited PATCH /rx-pad.
 * Here we do the LLM calls plus their bookkeeping: cost circuit, call-log
 * rows (attributed to the psychologist for the rate limit + monthly
 * circuit), metrics, and a PLAN_DICTATION_PROPOSED audit row.
 */

/** Gemini audio input ≈ 32 tokens/second. */
const AUDIO_TOKENS_PER_SECOND = 32;

/**
 * The ASR leg of a spoken instruction: cost-circuit gate → medical Pass 1 →
 * call log + metrics. Returns the transcript, or null when transcription
 * failed (the caller answers 502 — never a fabricated command).
 */
export async function transcribePlanCommand(args: {
  sessionId: string;
  psychologistId: string;
  audioBytes: Buffer;
  durationMs: number;
  spokenLanguageHints?: string[];
}): Promise<string | null> {
  const estimate = computeCostInr(
    Math.ceil(args.durationMs / 1000) * AUDIO_TOKENS_PER_SECOND + 300,
    300,
    FLASH_PRICING,
  );
  await checkCostCircuit({
    sessionId: args.sessionId,
    psychologistId: args.psychologistId,
    estimatedCostInr: estimate,
  });

  let result;
  try {
    result = await modelRouter().pass1({
      sessionId: args.sessionId,
      audioBytes: args.audioBytes,
      durationMs: args.durationMs,
      vertical: 'DOCTOR',
      ...(args.spokenLanguageHints &&
        args.spokenLanguageHints.length > 0 && {
          hints: { spokenLanguageHints: args.spokenLanguageHints },
        }),
    });
  } catch (e) {
    await recordFailure(e, args.psychologistId);
    return null;
  }
  await persistCallLog(result.callLog, args.psychologistId);
  recordGeminiCall({
    pass: result.callLog.pass,
    status: result.callLog.status,
    region: result.callLog.region,
    durationMs: result.callLog.latencyMs,
  });
  recordCostInr({
    service: 'gemini-pass-1',
    durationLabel: 'plan-dictation-asr',
    inr: result.callLog.costInr,
  });
  if (result.callLog.status !== 'SUCCESS') return null;
  return result.output.transcript;
}

export async function runPlanDictation(args: {
  sessionId: string;
  psychologistId: string;
  /** The doctor's instruction — ASR transcript or typed text. */
  command: string;
  rxPad: RxPadDraft;
  language: ClinicalLocale;
}): Promise<PlanDictationV1> {
  const estimate = computeCostInr(
    Math.ceil((args.command.length + JSON.stringify(args.rxPad).length) / 4) + 800,
    400,
    FLASH_PRICING,
  );
  await checkCostCircuit({
    sessionId: args.sessionId,
    psychologistId: args.psychologistId,
    estimatedCostInr: estimate,
  });

  const router = modelRouter();
  let result;
  try {
    result = await router.passPlanDictation({
      sessionId: args.sessionId,
      command: args.command,
      rxPad: args.rxPad,
      language: args.language,
    });
  } catch (e) {
    await recordFailure(e, args.psychologistId);
    throw e;
  }

  await persistCallLog(result.callLog, args.psychologistId);
  recordGeminiCall({
    pass: result.callLog.pass,
    status: result.callLog.status,
    region: result.callLog.region,
    durationMs: result.callLog.latencyMs,
  });
  recordCostInr({
    service: 'gemini-pass-14',
    durationLabel: 'plan-dictation',
    inr: result.callLog.costInr,
  });

  const dictation = result.output.dictation;
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: args.psychologistId,
    action: 'PLAN_DICTATION_PROPOSED',
    targetType: 'Session',
    targetId: args.sessionId,
    metadata: {
      sessionId: args.sessionId,
      editCount: dictation.edits.length,
      clarificationCount: dictation.clarifications.length,
      costInr: result.callLog.costInr,
    },
  });

  return dictation;
}

/** Backend errors carry their call-log — persist the failure trail too. */
async function recordFailure(e: unknown, psychologistId: string): Promise<void> {
  const callLog = (e as { callLog?: GeminiCallLogData }).callLog;
  if (!callLog) return;
  await persistCallLog(callLog, psychologistId).catch(() => {
    /* the failure response matters more than the failed log row */
  });
  recordGeminiCall({
    pass: callLog.pass,
    status: callLog.status,
    region: callLog.region,
    durationMs: callLog.latencyMs,
  });
}

async function persistCallLog(log: GeminiCallLogData, psychologistId: string): Promise<void> {
  await prisma.geminiCallLog.create({
    data: {
      ...(log.sessionId !== undefined && { sessionId: log.sessionId }),
      psychologistId,
      pass: log.pass,
      model: log.model,
      region: log.region,
      promptVersion: log.promptVersion,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      costInr: new Prisma.Decimal(log.costInr),
      latencyMs: log.latencyMs,
      status: log.status,
      ...(log.errorMessage !== undefined && { errorMessage: log.errorMessage }),
    },
  });
}
