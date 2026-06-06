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
  PENDING_SECTION_CONFIRMATIONS,
  type ClinicalLocale,
} from '@cureocity/contracts';
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

  // Idempotency — only short-circuit if the previous run produced
  // substantive content. A COMPLETED draft with zero transcript chars
  // is a hallucinated/silent failure (the model returned valid JSON
  // satisfying the schema but with empty fields — observed when
  // safety filters were on or audio decode failed). Re-running gets
  // a fresh shot at the actual audio.
  const existing = await prisma.noteDraft.findUnique({ where: { sessionId } });
  if (existing?.status === 'COMPLETED' && (existing.transcript?.length ?? 0) > 0) {
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
      throw new Error(
        'No audio chunks reached storage for this session. Record at least one 30-second chunk and end the session again — the orchestrator skips empty sessions to avoid an unnecessary Gemini bill.',
      );
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

    // Pass 3 — Clinical Analysis. Best-effort: a Pass 3 failure does
    // NOT fail note generation; the Clinical Brief tab surfaces the
    // failure and offers a manual retry via POST /clinical-analysis.
    // Sprint 13.
    await runClinicalAnalysis({
      sessionId,
      clientId: session.clientId,
      psychologistId: session.psychologistId,
      language: (session.language as ClinicalLocale | undefined) ?? 'en',
      modality: session.modality,
      presentingConcerns: session.client.presentingConcerns,
      transcript: pass1.output.transcript,
      speakerSegments: pass1.output.speakerSegments,
      note: pass2.output.therapyNote,
    });

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

  // Prefer inline BYTEA (Sprint 2 fallback storage). Fall back to fetching
  // the external Blob URL for legacy rows that pre-date the inline path —
  // a private Vercel Blob URL needs the read-write token via Authorization.
  const blobToken = process.env['BLOB_READ_WRITE_TOKEN'];
  const authHeader: Record<string, string> = blobToken
    ? { Authorization: `Bearer ${blobToken}` }
    : {};

  const buffers: Buffer[] = [];
  let totalDurationMs = 0;
  for (const chunk of chunks) {
    if (chunk.bytes && chunk.bytes.byteLength > 0) {
      buffers.push(Buffer.from(chunk.bytes));
    } else if (chunk.s3Key) {
      const res = await fetch(chunk.s3Key, { headers: authHeader });
      if (!res.ok) throw new Error(`Failed to fetch chunk ${chunk.chunkIndex}: ${res.status}`);
      buffers.push(Buffer.from(await res.arrayBuffer()));
    } else {
      throw new Error(
        `Chunk ${chunk.chunkIndex} has neither inline bytes nor an s3Key — storage row is corrupt`,
      );
    }
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

// ============================================================================
// Pass 3 — Clinical Analysis (Sprint 13).
// Called inline after Pass 2 succeeds. Reads the client's prior
// confirmed diagnoses + active treatment plan from the cumulative
// tables so the report grounds itself in history. Failure is non-
// fatal — the ClinicalReport row is marked FAILED + errorMessage set,
// and the Clinical Brief tab surfaces a manual retry.
// ============================================================================

interface ClinicalAnalysisArgs {
  sessionId: string;
  clientId: string;
  psychologistId: string;
  language: ClinicalLocale;
  modality: Pass2Output['therapyNote']['modality'];
  presentingConcerns: string | null;
  transcript: string;
  speakerSegments: Pass1Output['speakerSegments'];
  note: Pass2Output['therapyNote'];
}

export async function runClinicalAnalysis(args: ClinicalAnalysisArgs): Promise<void> {
  // Upsert the report row in PENDING so the UI can poll for it
  // (matches NoteDraft IN_PROGRESS pattern).
  const report = await prisma.clinicalReport.upsert({
    where: { sessionId: args.sessionId },
    update: {
      status: 'PENDING',
      errorMessage: null,
      // Preserve confirmations across retries; a re-run shouldn't
      // erase the therapist's accept/reject decisions.
    },
    create: {
      sessionId: args.sessionId,
      clientId: args.clientId,
      psychologistId: args.psychologistId,
      status: 'PENDING',
      confirmations: PENDING_SECTION_CONFIRMATIONS as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    // Cost-guard pre-check. Estimate ~ Pass 2 input + report output;
    // Pass 3 reads the same transcript + a small JSON note + history.
    const pass3Estimate = computeCostInr(
      Math.ceil(args.transcript.length / 4) + 1_000,
      2_000,
      PRO_PRICING,
    );
    await checkCostCircuit({
      sessionId: args.sessionId,
      psychologistId: args.psychologistId,
      estimatedCostInr: pass3Estimate,
    });

    // Pull cumulative history for the prompt.
    const [activeDiagnoses, activePlan] = await Promise.all([
      prisma.clientDiagnosis.findMany({
        where: { clientId: args.clientId, supersededAt: null },
        orderBy: [{ isPrimary: 'desc' }, { confirmedAt: 'desc' }],
        take: 5,
      }),
      prisma.treatmentPlan.findFirst({
        where: { clientId: args.clientId, supersededAt: null },
        orderBy: { version: 'desc' },
      }),
    ]);

    const priorDiagnoses = activeDiagnoses.map((d) => ({
      icd11Code: d.icd11Code,
      icd11Label: d.icd11Label,
      confidence: d.confidence,
      isPrimary: d.isPrimary,
      confirmedAt: d.confirmedAt.toISOString(),
    }));
    const priorTreatmentPlan = activePlan
      ? {
          modality:
            (activePlan.body as { modality?: string } | null)?.modality ?? 'unknown',
          phaseSequence:
            (activePlan.body as { phaseSequence?: string[] } | null)?.phaseSequence ?? [],
          goals:
            (activePlan.body as { goals?: { description: string; measure: string }[] } | null)
              ?.goals ?? [],
          expectedDurationSessions:
            (activePlan.body as { expectedDurationSessions?: number | null } | null)
              ?.expectedDurationSessions ?? null,
          version: activePlan.version,
          confirmedAt: activePlan.confirmedAt.toISOString(),
        }
      : null;

    const router = modelRouter();
    const pass3 = await router.pass3({
      sessionId: args.sessionId,
      transcript: args.transcript,
      speakerSegments: args.speakerSegments,
      modality: args.modality,
      language: args.language,
      note: args.note,
      clientContext: {
        ...(args.presentingConcerns !== null && {
          presentingConcerns: args.presentingConcerns,
        }),
        ...(priorDiagnoses.length > 0 && { priorDiagnoses }),
        ...(priorTreatmentPlan && { priorTreatmentPlan }),
      },
    });

    await persistCallLog(pass3.callLog);
    recordGeminiCall({
      pass: pass3.callLog.pass,
      status: pass3.callLog.status,
      region: pass3.callLog.region,
      durationMs: pass3.callLog.latencyMs,
    });
    recordCostInr({
      service: 'gemini-pass-3',
      durationLabel: 'clinical',
      inr: pass3.callLog.costInr,
    });

    await prisma.clinicalReport.update({
      where: { id: report.id },
      data: {
        status: 'COMPLETED',
        body: pass3.output.clinicalReport as unknown as Prisma.InputJsonValue,
        totalCostInr: new Prisma.Decimal(pass3.callLog.costInr),
      },
    });

    await writeAudit({
      actorType: 'SYSTEM',
      action: 'CLINICAL_REPORT_GENERATED',
      targetType: 'ClinicalReport',
      targetId: report.id,
      metadata: {
        sessionId: args.sessionId,
        clientId: args.clientId,
        psychologistId: args.psychologistId,
        diagnosisCandidateCount: pass3.output.clinicalReport.diagnosisCandidates.length,
        crisisFlagCount: pass3.output.clinicalReport.crisisFlags.length,
        costInr: pass3.callLog.costInr,
      },
    });
  } catch (e) {
    const message = (e as Error).message;
    await prisma.clinicalReport
      .update({
        where: { id: report.id },
        data: { status: 'FAILED', errorMessage: message },
      })
      .catch(() => {
        // Swallow — primary failure already logged below.
      });
    if (e instanceof CostCircuitOpenError) {
      recordCostCircuitTrip(e.meta.scope);
    }
    console.error(
      `[clinical-analysis] sessionId=${args.sessionId} failed: ${message}`,
    );
    // Non-fatal: do NOT re-throw. Pass 3 failure must not unwind
    // Pass 1/2 success.
  }
}
