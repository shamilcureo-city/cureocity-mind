import { Prisma, type NoteRiskSeverity as PrismaRiskSeverity } from '@prisma/client';
import {
  computeCostInr,
  estimateAudioInputTokens,
  FLASH_PRICING,
  PRO_PRICING,
  type GeminiCallLogData,
  type Pass1Output,
  type Pass2Output,
} from '@cureocity/llm';
import {
  recordCostCircuitTrip,
  recordCostInr,
  recordCrisisFlag,
  recordGeminiCall,
} from '@cureocity/observability';
import { writeAudit } from './audit';
import { CostCircuitOpenError, checkCostCircuit } from './cost-guard';
import { modelRouter } from './llm';
import { prisma } from './prisma';

/**
 * Synchronous orchestrator port — runs Pass 1 → Pass 2 inline on the
 * /sessions/:id/generate-note request. The 60s Vercel Pro function
 * budget bounds how long this can take; the cost-guard caps the spend.
 *
 * Note: Vercel Functions can't run a BullMQ worker, so failed/timed-out
 * runs leave NoteDraft in IN_PROGRESS state for retry on the next
 * request. POST /sessions/:id/generate-note is idempotent for a draft
 * already in COMPLETED state (returns immediately).
 */

export interface OrchestratorResult {
  draftId: string;
  status: 'COMPLETED' | 'FAILED';
  errorMessage?: string;
}

export async function runNoteGeneration(sessionId: string): Promise<OrchestratorResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { client: true },
  });
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Idempotency — already done.
  const existing = await prisma.noteDraft.findUnique({ where: { sessionId } });
  if (existing?.status === 'COMPLETED') {
    return { draftId: existing.id, status: 'COMPLETED' };
  }

  const draft = await prisma.noteDraft.upsert({
    where: { sessionId },
    update: { status: 'IN_PROGRESS', errorMessage: null },
    create: { sessionId, status: 'IN_PROGRESS' },
  });

  try {
    const { audioBytes, durationMs } = await fetchAudio(sessionId);
    const llmBackend = process.env['LLM_BACKEND'] ?? 'mock';
    if (audioBytes.byteLength === 0 && llmBackend !== 'mock') {
      throw new Error('No audio chunks uploaded for session');
    }

    // Pass 1 cost-guard pre-check
    const pass1Estimate = computeCostInr(
      estimateAudioInputTokens(durationMs),
      1_000,
      FLASH_PRICING,
    );
    await checkCostCircuit({
      sessionId,
      psychologistId: session.psychologistId,
      estimatedCostInr: pass1Estimate,
    });

    const router = modelRouter();
    const pass1 = await router.pass1({ sessionId, audioBytes, durationMs });
    await persistCallLog(pass1.callLog);
    recordGeminiCall({
      pass: pass1.callLog.pass,
      status: pass1.callLog.status,
      region: pass1.callLog.region,
      durationMs: pass1.callLog.latencyMs,
    });
    recordCostInr({
      service: 'gemini-pass-1',
      durationLabel: bucketDuration(durationMs),
      inr: pass1.callLog.costInr,
    });
    const pass1Cost = new Prisma.Decimal(pass1.callLog.costInr);

    await prisma.noteDraft.update({
      where: { id: draft.id },
      data: {
        transcript: pass1.output.transcript,
        speakerSegments: pass1.output.speakerSegments as unknown as Prisma.InputJsonValue,
        affectFeatures: pass1.output.affectFeatures as unknown as Prisma.InputJsonValue,
        totalCostInr: pass1Cost,
      },
    });

    // Pass 2 cost-guard pre-check
    const pass2Estimate = computeCostInr(
      Math.ceil(pass1.output.transcript.length / 4),
      1_500,
      PRO_PRICING,
    );
    await checkCostCircuit({
      sessionId,
      psychologistId: session.psychologistId,
      estimatedCostInr: pass2Estimate,
    });

    const pass2 = await router.pass2({
      sessionId,
      transcript: pass1.output.transcript,
      speakerSegments: pass1.output.speakerSegments,
      modality: session.modality,
      clientContext: {
        ...(session.client.presentingConcerns !== null && {
          presentingConcerns: session.client.presentingConcerns,
        }),
        ...(session.client.preferredModality !== null && {
          preferredModality: session.client
            .preferredModality as Pass2Output['therapyNote']['modality'],
        }),
      },
    });
    await persistCallLog(pass2.callLog);
    recordGeminiCall({
      pass: pass2.callLog.pass,
      status: pass2.callLog.status,
      region: pass2.callLog.region,
      durationMs: pass2.callLog.latencyMs,
    });
    recordCostInr({
      service: 'gemini-pass-2',
      durationLabel: bucketDuration(durationMs),
      inr: pass2.callLog.costInr,
    });
    const pass2Cost = new Prisma.Decimal(pass2.callLog.costInr);

    const riskSeverity = mapRiskSeverity(pass2.output.therapyNote.riskFlags.severity);
    await prisma.noteDraft.update({
      where: { id: draft.id },
      data: {
        content: pass2.output.therapyNote as unknown as Prisma.InputJsonValue,
        riskSeverity,
        status: 'COMPLETED',
        totalCostInr: pass1Cost.plus(pass2Cost),
      },
    });

    await writeAudit({
      actorType: 'SYSTEM',
      action: 'NOTE_DRAFT_CREATED',
      targetType: 'NoteDraft',
      targetId: draft.id,
      metadata: {
        sessionId,
        pass1CostInr: pass1.callLog.costInr,
        pass2CostInr: pass2.callLog.costInr,
        totalCostInr: pass1.callLog.costInr + pass2.callLog.costInr,
        riskSeverity,
      },
    });

    if (riskSeverity === 'HIGH' || riskSeverity === 'CRITICAL') {
      recordCrisisFlag(riskSeverity);
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'CRISIS_FLAG_RAISED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          severity: riskSeverity,
          indicators: pass2.output.therapyNote.riskFlags.indicators,
          details: pass2.output.therapyNote.riskFlags.details ?? null,
          psychologistId: session.psychologistId,
          clientId: session.clientId,
        },
      });
    }

    return { draftId: draft.id, status: 'COMPLETED' };
  } catch (e) {
    const message = (e as Error).message;
    await prisma.noteDraft.update({
      where: { id: draft.id },
      data: { status: 'FAILED', errorMessage: message },
    });
    if (e instanceof CostCircuitOpenError) {
      recordCostCircuitTrip(e.meta.scope);
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'COST_CIRCUIT_TRIPPED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          scope: e.meta.scope,
          capInr: e.meta.capInr,
          currentInr: e.meta.currentInr,
          projectedInr: e.meta.projectedInr,
          psychologistId: session.psychologistId,
          clientId: session.clientId,
        },
      });
      await prisma.geminiCallLog.create({
        data: {
          sessionId,
          pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
          model: 'circuit-open',
          region: 'n/a',
          promptVersion: 'n/a',
          inputTokens: 0,
          outputTokens: 0,
          costInr: 0,
          latencyMs: 0,
          status: 'CIRCUIT_OPEN',
          errorMessage: message,
        },
      });
    }
    return { draftId: draft.id, status: 'FAILED', errorMessage: message };
  }
}

async function fetchAudio(sessionId: string): Promise<{ audioBytes: Buffer; durationMs: number }> {
  const chunks = await prisma.audioChunk.findMany({
    where: { sessionId },
    orderBy: { chunkIndex: 'asc' },
  });
  if (chunks.length === 0) return { audioBytes: Buffer.alloc(0), durationMs: 0 };

  // Vercel Blob URLs stored in s3Key — fetch directly via HTTP.
  const buffers: Buffer[] = [];
  let totalDurationMs = 0;
  for (const chunk of chunks) {
    const res = await fetch(chunk.s3Key);
    if (!res.ok) throw new Error(`Failed to fetch chunk ${chunk.chunkIndex}: ${res.status}`);
    buffers.push(Buffer.from(await res.arrayBuffer()));
    totalDurationMs += chunk.durationMs;
  }
  return { audioBytes: Buffer.concat(buffers), durationMs: totalDurationMs };
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

function mapRiskSeverity(severity: Pass1Output extends never ? never : string): PrismaRiskSeverity {
  switch (severity) {
    case 'critical':
      return 'CRITICAL';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    default:
      return 'NONE';
  }
}

/** Bucket a session duration for low-cardinality metric labels. */
function bucketDuration(ms: number): string {
  const min = ms / 60_000;
  if (min < 15) return 'lt_15m';
  if (min < 30) return '15_30m';
  if (min < 45) return '30_45m';
  if (min < 60) return '45_60m';
  return 'gt_60m';
}
