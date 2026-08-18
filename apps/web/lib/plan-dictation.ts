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
import { withActiveSessionPhiWrite } from './phi-write-lock';
import { prisma } from './prisma';
import { assertCurrentScribeAuthority } from './scribe-authority';

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

  try {
    await assertCurrentScribeAuthority(args.sessionId, {
      psychologistId: args.psychologistId,
      source: 'planDictationPass1BeforeModel',
    });
  } catch (error) {
    args.audioBytes.fill(0);
    throw error;
  }

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
    await recordFailure(e, args.sessionId, args.psychologistId);
    return null;
  } finally {
    // The backend receives this buffer by reference. Never retain dictated PHI.
    args.audioBytes.fill(0);
  }
  try {
    await assertCurrentScribeAuthority(args.sessionId, {
      psychologistId: args.psychologistId,
      source: 'planDictationPass1BeforePersistence',
    });
  } catch (error) {
    clearPass1Output(result.output);
    throw error;
  }
  // PLAN_DICTATION_ASR_CALL_LOG — the model call and future auth recheck are
  // outside this short lock; erasure wins before any delayed ledger row.
  await withActiveSessionPhiWrite(prisma, args.sessionId, args.psychologistId, (tx) =>
    persistCallLog(result.callLog, args.sessionId, args.psychologistId, tx),
  );
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
  await assertCurrentScribeAuthority(args.sessionId, {
    psychologistId: args.psychologistId,
    source: 'planDictationPass14BeforeModel',
  });
  let result;
  try {
    result = await router.passPlanDictation({
      sessionId: args.sessionId,
      command: args.command,
      rxPad: args.rxPad,
      language: args.language,
    });
  } catch (e) {
    await recordFailure(e, args.sessionId, args.psychologistId);
    throw e;
  }

  try {
    await assertCurrentScribeAuthority(args.sessionId, {
      psychologistId: args.psychologistId,
      source: 'planDictationPass14BeforePersistence',
    });
  } catch (error) {
    result.output.dictation.edits = [];
    result.output.dictation.clarifications = [];
    throw error;
  }

  const dictation = result.output.dictation;
  // PLAN_DICTATION_PROPOSAL_WRITE_GROUP — after the model call and auth
  // recheck, commit the linked call log and proposal audit under one Client lock.
  await withActiveSessionPhiWrite(prisma, args.sessionId, args.psychologistId, async (tx) => {
    await persistCallLog(result.callLog, args.sessionId, args.psychologistId, tx);
    await writeAudit(
      {
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
      },
      tx,
    );
  });
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

  return dictation;
}

/** Backend errors carry their call-log — persist the failure trail too. */
async function recordFailure(e: unknown, sessionId: string, psychologistId: string): Promise<void> {
  const callLog = (e as { callLog?: GeminiCallLogData }).callLog;
  if (!callLog) return;
  // PLAN_DICTATION_FAILURE_CALL_LOG — the failed model/network call is over;
  // best-effort logging still obeys the same terminal erasure boundary.
  await withActiveSessionPhiWrite(prisma, sessionId, psychologistId, (tx) =>
    persistCallLog(callLog, sessionId, psychologistId, tx),
  ).catch(() => {
    /* the failure response matters more than the failed log row */
  });
  recordGeminiCall({
    pass: callLog.pass,
    status: callLog.status,
    region: callLog.region,
    durationMs: callLog.latencyMs,
  });
}

async function persistCallLog(
  log: GeminiCallLogData,
  sessionId: string,
  psychologistId: string,
  tx: Pick<Prisma.TransactionClient, 'geminiCallLog'>,
): Promise<void> {
  await tx.geminiCallLog.create({
    data: {
      sessionId,
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

function clearPass1Output(output: {
  transcript: string;
  speakerSegments: unknown[];
  affectFeatures: unknown[];
  detectedLanguages: string[];
}): void {
  output.transcript = '';
  output.speakerSegments = [];
  output.affectFeatures = [];
  output.detectedLanguages = [];
}
