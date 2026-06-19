import { Prisma, type NoteRiskSeverity as PrismaRiskSeverity } from '@prisma/client';
import {
  computeCostInr,
  estimateAudioInputTokens,
  FLASH_PRICING,
  PRO_PRICING,
  type GeminiCallLogData,
  type Pass1Output,
} from '@cureocity/llm';
import {
  PENDING_SECTION_CONFIRMATIONS,
  type ClinicalLocale,
  type ClinicalOrderV1,
  type MedicalEncounterNoteV1,
  type MedicationOrderV1,
} from '@cureocity/contracts';
import { interactionWarningsByDrug } from '@cureocity/clinical';
import {
  recordCostCircuitTrip,
  recordCostInr,
  recordCrisisFlag,
  recordGeminiCall,
} from '@cureocity/observability/metrics';
import { reconcileAssessmentItems } from './assessment-items';
import { writeAudit } from './audit';
import { CostCircuitOpenError, checkCostCircuit } from './cost-guard';
import { encryptForTenant } from './tenant-crypto';
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
  /**
   * Sprint 19 hotfix — Pass 3 arguments returned to the caller instead
   * of being awaited inline. The generate-note route schedules
   * runClinicalAnalysis via Next.js `after()` so Pass 3 doesn't push
   * the synchronous response past the function's maxDuration window
   * (the original cause of intermittent 504s in production).
   */
  pendingClinicalAnalysisArgs?: ClinicalAnalysisArgs;
}

export async function runNoteGeneration(sessionId: string): Promise<OrchestratorResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { client: true, psychologist: { select: { vertical: true } } },
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
    const clientSpokenHints =
      Array.isArray(session.client.spokenLanguages) && session.client.spokenLanguages.length > 0
        ? session.client.spokenLanguages
        : undefined;
    const pass1 = await router.pass1({
      sessionId,
      audioBytes,
      durationMs,
      ...(clientSpokenHints && {
        hints: { spokenLanguageHints: clientSpokenHints },
      }),
    });
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

    // Sprint 54 — dual-write the envelope-encrypted transcript. The
    // verbatim session transcript is the most sensitive clinical
    // content we store, so it joins the at-rest encryption rollout via
    // the same per-tenant DEK path as Client PII. Best-effort: a KMS
    // hiccup must NOT fail an otherwise-complete note generation — we
    // log + leave `transcriptEncrypted` null (the backfill route can
    // catch it up later), exactly as the plaintext column behaves today.
    let transcriptEncrypted: string | null = null;
    try {
      transcriptEncrypted = await encryptForTenant(session.psychologistId, pass1.output.transcript);
    } catch (e) {
      console.warn(
        `[note-orchestrator] transcript encryption failed for session=${sessionId}; storing plaintext only: ${(e as Error).message}`,
      );
    }

    await prisma.noteDraft.update({
      where: { id: draft.id },
      data: {
        transcript: pass1.output.transcript,
        transcriptEncrypted,
        speakerSegments: pass1.output.speakerSegments as unknown as Prisma.InputJsonValue,
        affectFeatures: pass1.output.affectFeatures as unknown as Prisma.InputJsonValue,
        totalCostInr: pass1Cost,
      },
    });

    // Sprint 16 — persist the languages Pass 1 actually detected onto
    // the Session row. Used by the UI to show language badges +
    // by Pass 4 to choose the verbatim therapistSays language when
    // the client has no spokenLanguages on file.
    if (pass1.output.detectedLanguages.length > 0) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { spokenLanguages: pass1.output.detectedLanguages },
      });
    }

    // Sprint 56 hotfix — guard against an empty Pass 1 transcript.
    // A zero-char transcript means the recording had no intelligible
    // speech (silent / wrong mic / muted input) OR Gemini returned an
    // empty candidate. Running Pass 2 on it just produces a misleading
    // note full of "(not elicited)" — the confusing symptom hit on the
    // first real prod intake (2026-06-16). Fail loudly + retryably
    // instead, and skip the Pass 2 bill. Retry re-runs Pass 1 (the
    // idempotency check short-circuits only when transcriptChars > 0).
    if (pass1.output.transcript.trim().length === 0) {
      const pass1Errored = pass1.callLog.status === 'ERROR';
      const detail =
        pass1Errored && pass1.callLog.errorMessage
          ? ` Transcription error: ${pass1.callLog.errorMessage}.`
          : '';
      const message =
        `Transcription came back empty.${detail} The recording likely had no audible speech — ` +
        `check your microphone / input device and that you weren't muted — or the model returned ` +
        `nothing this time. No note was generated (you were not charged for note-writing). ` +
        `Re-record, or hit Retry to run transcription again on the same audio.`;
      await prisma.noteDraft.update({
        where: { id: draft.id },
        data: { status: 'FAILED', errorMessage: message },
      });
      return { draftId: draft.id, status: 'FAILED', errorMessage: message };
    }

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
      // Sprint DV3 — DOCTOR routes Pass 2 to the medical encounter note
      // (the MEDICAL output arm) instead of the therapy SOAP/intake note.
      vertical: session.psychologist.vertical,
      // Sprint 19 — session.kind drives Pass 2 prompt branch (intake
      // note vs treatment SOAP). modality is nullable; orchestrator
      // passes whatever the cascade picked at session-create time.
      kind: session.kind,
      modality: session.modality,
      clientContext: {
        ...(session.client.presentingConcerns !== null && {
          presentingConcerns: session.client.presentingConcerns,
        }),
        ...(session.client.preferredModality !== null && {
          preferredModality: session.client.preferredModality as Parameters<
            typeof router.pass2
          >[0]['clientContext']['preferredModality'],
        }),
      },
    });
    // Sprint DV3 — doctors get a medical encounter note. Store it, audit
    // ENCOUNTER_NOTE_DRAFTED, and return: there is no therapy risk-flag
    // handling and no Pass 3 (the medical differential is DV6). This must
    // branch BEFORE the therapy-only union arms are read below.
    if (pass2.output.kind === 'MEDICAL') {
      const encounterNote = pass2.output.encounterNote;
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
      const pass2CostMedical = new Prisma.Decimal(pass2.callLog.costInr);
      await prisma.noteDraft.update({
        where: { id: draft.id },
        data: {
          content: encounterNote as unknown as Prisma.InputJsonValue,
          riskSeverity: mapRiskSeverity('none'),
          status: 'COMPLETED',
          totalCostInr: pass1Cost.plus(pass2CostMedical),
        },
      });
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'ENCOUNTER_NOTE_DRAFTED',
        targetType: 'NoteDraft',
        targetId: draft.id,
        metadata: {
          sessionId,
          pass1CostInr: pass1.callLog.costInr,
          pass2CostInr: pass2.callLog.costInr,
          totalCostInr: pass1.callLog.costInr + pass2.callLog.costInr,
        },
      });
      // Sprint DV5 — persist the drafted Rx + clinical orders. The
      // medication interaction-check runs deterministically server-side
      // here (never client-supplied), stamping each order's warnings.
      await persistDraftedOrders(
        sessionId,
        session.psychologistId,
        pass2.output.medications,
        pass2.output.orders,
      );
      // Sprint DV7 — capture the note's vitals into the chronic-reading
      // time series so the per-patient control trajectory builds itself.
      await persistVitalReadings(
        sessionId,
        session.clientId,
        session.psychologistId,
        session.scheduledAt,
        encounterNote.vitals,
      );
      return { draftId: draft.id, status: 'COMPLETED' };
    }

    // Sprint 19 — Pass 2 output is a discriminated union. Read the
    // body shape via the kind discriminator.
    const pass2Body =
      pass2.output.kind === 'INTAKE' ? pass2.output.intakeNote : pass2.output.therapyNote;
    const pass2RiskFlags = pass2Body.riskFlags;
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

    const riskSeverity = mapRiskSeverity(pass2RiskFlags.severity);
    await prisma.noteDraft.update({
      where: { id: draft.id },
      data: {
        // Sprint 19 — Pass 2 output body is either TherapyNoteV1 or
        // IntakeNoteV1 depending on session.kind. NoteDraft.content
        // is opaque JSON; the UI branches on session.kind to render
        // the correct view.
        content: pass2Body as unknown as Prisma.InputJsonValue,
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
          indicators: pass2RiskFlags.indicators,
          details: pass2RiskFlags.details ?? null,
          psychologistId: session.psychologistId,
          clientId: session.clientId,
        },
      });
    }

    // Pass 3 — Clinical Analysis. Best-effort: a Pass 3 failure does
    // NOT fail note generation. Sprint 13 ran it inline; Sprint 19
    // hotfix moves it to the route's `after()` block so the
    // synchronous Pass 1 + Pass 2 path can return as soon as the
    // note draft is committed. The Clinical Brief tab polls / shows
    // a manual retry button when Pass 3 fails or hasn't completed yet.
    const pendingClinicalAnalysisArgs: ClinicalAnalysisArgs = {
      sessionId,
      clientId: session.clientId,
      psychologistId: session.psychologistId,
      language: (session.language as ClinicalLocale | undefined) ?? 'en',
      kind: session.kind,
      modality: session.modality,
      presentingConcerns: session.client.presentingConcerns,
      transcript: pass1.output.transcript,
      speakerSegments: pass1.output.speakerSegments,
      // Sprint 19 — note shape depends on session.kind. Pass 3 prompt
      // branches on its own kind input; we pass the body opaquely.
      note: pass2Body,
    };

    return { draftId: draft.id, status: 'COMPLETED', pendingClinicalAnalysisArgs };
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

/**
 * Sprint DV5 — persist the AI-drafted Rx + clinical orders for a doctor
 * encounter. Replaces any existing DRAFT orders (so a note re-run is
 * clean) while leaving already-CONFIRMED orders untouched. The drug
 * interaction-check runs here, deterministically, and stamps each
 * medication order's `interactionWarnings`. Audits with literal action
 * strings (the chaos test scans for these).
 */
async function persistDraftedOrders(
  sessionId: string,
  psychologistId: string,
  medications: MedicationOrderV1[],
  clinicalOrders: ClinicalOrderV1[],
): Promise<void> {
  if (medications.length > 0) {
    const warningsByDrug = interactionWarningsByDrug(medications.map((m) => m.drug));
    await prisma.medicationOrder.deleteMany({ where: { sessionId, status: 'DRAFT' } });
    await prisma.medicationOrder.createMany({
      data: medications.map((m, i) => ({
        sessionId,
        psychologistId,
        content: {
          ...m,
          interactionWarnings: warningsByDrug[i] ?? [],
        } as unknown as Prisma.InputJsonValue,
      })),
    });
    await writeAudit({
      actorType: 'SYSTEM',
      action: 'MEDICATION_ORDER_DRAFTED',
      targetType: 'Session',
      targetId: sessionId,
      metadata: {
        sessionId,
        count: medications.length,
        interactionCount: warningsByDrug.filter((w) => w.length > 0).length,
      },
    });
  }
  if (clinicalOrders.length > 0) {
    await prisma.clinicalOrder.deleteMany({ where: { sessionId, status: 'DRAFT' } });
    await prisma.clinicalOrder.createMany({
      data: clinicalOrders.map((o) => ({
        sessionId,
        psychologistId,
        content: o as unknown as Prisma.InputJsonValue,
      })),
    });
    await writeAudit({
      actorType: 'SYSTEM',
      action: 'CLINICAL_ORDER_DRAFTED',
      targetType: 'Session',
      targetId: sessionId,
      metadata: { sessionId, count: clinicalOrders.length },
    });
  }
}

/**
 * Sprint DV7 — capture the medical note's vitals into the chronic-reading
 * time series. BP + weight only (the chronic measures with a vital
 * source; HbA1c / FBS / LDL are logged manually or from lab results).
 * Replaces any readings already captured for this session (so a note
 * re-run is clean). Audits with a literal action string.
 */
async function persistVitalReadings(
  sessionId: string,
  clientId: string,
  psychologistId: string,
  takenAt: Date,
  vitals: MedicalEncounterNoteV1['vitals'],
): Promise<void> {
  if (!vitals) return;
  const rows: {
    clientId: string;
    psychologistId: string;
    sessionId: string;
    measure: 'BP' | 'WEIGHT';
    value: number;
    valueSecondary?: number;
    unit: string;
    takenAt: Date;
    source: string;
  }[] = [];
  if (vitals.bpSystolic && vitals.bpDiastolic) {
    rows.push({
      clientId,
      psychologistId,
      sessionId,
      measure: 'BP',
      value: vitals.bpSystolic,
      valueSecondary: vitals.bpDiastolic,
      unit: 'mmHg',
      takenAt,
      source: 'NOTE_VITALS',
    });
  }
  if (vitals.weightKg) {
    rows.push({
      clientId,
      psychologistId,
      sessionId,
      measure: 'WEIGHT',
      value: vitals.weightKg,
      unit: 'kg',
      takenAt,
      source: 'NOTE_VITALS',
    });
  }
  if (rows.length === 0) return;
  await prisma.clinicalReading.deleteMany({ where: { sessionId, source: 'NOTE_VITALS' } });
  await prisma.clinicalReading.createMany({ data: rows });
  await writeAudit({
    actorType: 'SYSTEM',
    action: 'CLINICAL_READING_RECORDED',
    targetType: 'Session',
    targetId: sessionId,
    metadata: { sessionId, clientId, source: 'NOTE_VITALS', count: rows.length },
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

export interface ClinicalAnalysisArgs {
  sessionId: string;
  clientId: string;
  psychologistId: string;
  language: ClinicalLocale;
  /// Sprint 19 — session classification driving Pass 3 prompt branch.
  kind: import('@cureocity/contracts').SessionKind;
  /// Sprint 19 — modality is nullable for INTAKE sessions.
  modality: import('@cureocity/contracts').SessionModality | null;
  presentingConcerns: string | null;
  transcript: string;
  speakerSegments: Pass1Output['speakerSegments'];
  /// Sprint 19 — note body is either TherapyNoteV1 or IntakeNoteV1
  /// depending on kind. Pass 3 reads it opaquely; the prompt has
  /// its own kind-aware branch.
  note: unknown;
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
          modality: (activePlan.body as { modality?: string } | null)?.modality ?? 'unknown',
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
      kind: args.kind,
      modality: args.modality,
      language: args.language,
      // Sprint 19 — note is union TherapyNoteV1 | IntakeNoteV1; the
      // Pass 3 prompt branches on its own kind input. Cast is safe
      // because Pass3Input.note accepts the union.
      note: args.note as Parameters<typeof router.pass3>[0]['note'],
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

    // Sprint 19 — Pass 3 output is a discriminated union. INTAKE
    // sessions produce InitialAssessmentBriefV1; TREATMENT/REVIEW
    // produce ClinicalReportV1. ClinicalReport.body stores either
    // opaquely; the UI branches on session.kind to render.
    const pass3Body =
      pass3.output.kind === 'INTAKE'
        ? pass3.output.initialAssessmentBrief
        : pass3.output.clinicalReport;
    const candidateCount =
      pass3.output.kind === 'INTAKE'
        ? pass3.output.initialAssessmentBrief.differential.length
        : pass3.output.clinicalReport.diagnosisCandidates.length;
    const crisisCount =
      pass3.output.kind === 'INTAKE'
        ? pass3.output.initialAssessmentBrief.crisisFlags.length
        : pass3.output.clinicalReport.crisisFlags.length;

    await prisma.clinicalReport.update({
      where: { id: report.id },
      data: {
        status: 'COMPLETED',
        body: pass3Body as unknown as Prisma.InputJsonValue,
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
        kind: pass3.output.kind,
        diagnosisCandidateCount: candidateCount,
        crisisFlagCount: crisisCount,
        costInr: pass3.callLog.costInr,
      },
    });

    // Sprint 22 — reconcile the brief's diagnostic gaps into the
    // running differential (persistent AssessmentItems). Best-effort:
    // a reconcile failure must not fail the clinical analysis.
    try {
      await reconcileAssessmentItems({
        clientId: args.clientId,
        psychologistId: args.psychologistId,
        sourceSessionId: args.sessionId,
        pass3Body,
        kind: pass3.output.kind,
      });
    } catch (e) {
      console.error(
        `[assessment-items] reconcile failed for session ${args.sessionId}: ${(e as Error).message}`,
      );
    }
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
    console.error(`[clinical-analysis] sessionId=${args.sessionId} failed: ${message}`);
    // Non-fatal: do NOT re-throw. Pass 3 failure must not unwind
    // Pass 1/2 success.
  }
}

// ============================================================================
// Sprint DV6 — the differential pass (doctor vertical). The medical
// analogue of runClinicalAnalysis: encounter note + transcript →
// DifferentialDiagnosisV1, stored in the `differentials` table. On-demand
// (the encounter panel triggers it once the note is ready); decision-
// support only, never auto-applied. See docs/DOCTOR_VERTICAL.md §6, §7.
// ============================================================================

export interface DifferentialArgs {
  sessionId: string;
  psychologistId: string;
  language: ClinicalLocale;
  specialty: string | null;
  transcript: string;
  speakerSegments: Pass1Output['speakerSegments'];
  encounterNote: MedicalEncounterNoteV1;
}

export async function runDifferential(args: DifferentialArgs): Promise<void> {
  await prisma.differential.upsert({
    where: { sessionId: args.sessionId },
    update: { status: 'IN_PROGRESS', errorMessage: null },
    create: {
      sessionId: args.sessionId,
      psychologistId: args.psychologistId,
      status: 'IN_PROGRESS',
    },
  });

  try {
    const estimate = computeCostInr(
      Math.ceil(args.transcript.length / 4) + 1_000,
      1_500,
      PRO_PRICING,
    );
    await checkCostCircuit({
      sessionId: args.sessionId,
      psychologistId: args.psychologistId,
      estimatedCostInr: estimate,
    });

    const router = modelRouter();
    const result = await router.passDifferential({
      sessionId: args.sessionId,
      transcript: args.transcript,
      speakerSegments: args.speakerSegments,
      encounterNote: args.encounterNote,
      ...(args.specialty ? { specialty: args.specialty } : {}),
      language: args.language,
    });

    await persistCallLog(result.callLog);
    recordGeminiCall({
      pass: result.callLog.pass,
      status: result.callLog.status,
      region: result.callLog.region,
      durationMs: result.callLog.latencyMs,
    });
    recordCostInr({
      service: 'gemini-pass-9',
      durationLabel: 'differential',
      inr: result.callLog.costInr,
    });

    await prisma.differential.update({
      where: { sessionId: args.sessionId },
      data: {
        status: 'COMPLETED',
        body: result.output.differential as unknown as Prisma.InputJsonValue,
        errorMessage: null,
      },
    });

    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: args.psychologistId,
      action: 'DIFFERENTIAL_GENERATED',
      targetType: 'Session',
      targetId: args.sessionId,
      metadata: {
        sessionId: args.sessionId,
        candidateCount: result.output.differential.candidates.length,
        codingNudgeCount: result.output.differential.codingNudges.length,
        costInr: result.callLog.costInr,
      },
    });
  } catch (e) {
    const message = (e as Error).message;
    await prisma.differential
      .update({
        where: { sessionId: args.sessionId },
        data: { status: 'FAILED', errorMessage: message },
      })
      .catch(() => {
        /* primary failure logged below */
      });
    if (e instanceof CostCircuitOpenError) {
      recordCostCircuitTrip(e.meta.scope);
    }
    console.error(`[differential] sessionId=${args.sessionId} failed: ${message}`);
    // Non-fatal: don't re-throw — a differential failure must not unwind
    // the note + orders the doctor already has.
  }
}
