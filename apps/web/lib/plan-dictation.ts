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
 * Sprint DS12 — run the plan-dictation pass for one spoken instruction.
 *
 * Proposal-only: this NEVER writes to the pad. The route maps the returned
 * commands onto RxPadPatchOps via @cureocity/clinical's proposePlanEdits and
 * the doctor's Apply tap goes through the existing audited PATCH /rx-pad.
 * Here we do the LLM call plus its bookkeeping: cost circuit, call-log row,
 * metrics, and a PLAN_DICTATION_PROPOSED audit row.
 */
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
    // Backend errors carry their call-log — persist the failure trail too.
    const callLog = (e as { callLog?: GeminiCallLogData }).callLog;
    if (callLog) {
      await persistCallLog(callLog);
      recordGeminiCall({
        pass: callLog.pass,
        status: callLog.status,
        region: callLog.region,
        durationMs: callLog.latencyMs,
      });
    }
    throw e;
  }

  await persistCallLog(result.callLog);
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

async function persistCallLog(log: GeminiCallLogData): Promise<void> {
  await prisma.geminiCallLog.create({
    data: {
      ...(log.sessionId !== undefined && { sessionId: log.sessionId }),
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
