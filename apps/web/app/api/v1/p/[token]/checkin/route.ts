import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  CheckinSubmitInputSchema,
  InstrumentCheckinSnapshotSchema,
  PatientShareTokenSchema,
  ClinicalLocaleSchema,
  type ClinicalLocale,
} from '@cureocity/contracts';
import { INSTRUMENTS, InstrumentScoringError, scoreInstrument } from '@cureocity/clinical';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { processCrisisAlertOutbox } from '@/lib/crisis-alert-outbox';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { lockShareFamily } from '@/lib/share-family-lock';
import { isUsableResendAncestorStatus } from '@/lib/sprint5-final-behavior';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * POST /api/v1/p/[token]/checkin — Sprint 47.
 *
 * Public (no auth): the share token IS the authentication, same trust
 * model as the /p/<token> portal page. The client submits their
 * PHQ-9 / GAD-7 answers; we score deterministically and store an
 * InstrumentResponse tagged SELF so it joins the same trend the
 * in-session runner feeds.
 *
 * Safety: when the suicidality item (PHQ-9 #9) is endorsed we also
 * raise CRISIS_FLAG_RAISED so the therapist's crisis pathway picks it
 * up. The portal itself shows crisis resources to the client the
 * instant they endorse that item — a clinician isn't in the room.
 *
 * Idempotent-ish: a check-in can only be submitted once; re-posting
 * returns 409 so a double-tap or refresh can't create duplicate rows.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const tokenParse = PatientShareTokenSchema.safeParse(raw);
  if (!tokenParse.success) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }

  const share = await prisma.patientShare.findUnique({
    where: { shareToken: tokenParse.data },
    select: {
      id: true,
      shareBatchId: true,
      sessionId: true,
      clientId: true,
      psychologistId: true,
      artefactType: true,
      snapshot: true,
      language: true,
      status: true,
      expiresAt: true,
      // CLIN-1 — the owning therapist's contact for the immediate safety alert.
      psychologist: { select: { email: true, fullName: true } },
    },
  });
  if (!share || share.artefactType !== 'INSTRUMENT_CHECKIN') {
    return NextResponse.json({ error: 'Check-in not found' }, { status: 404 });
  }
  if (share.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'This check-in link has expired.' }, { status: 410 });
  }
  if (!['SENT', 'OPENED'].includes(share.status)) {
    return NextResponse.json({ error: 'Check-in not found' }, { status: 404 });
  }

  const snapParse = InstrumentCheckinSnapshotSchema.safeParse(share.snapshot);
  if (!snapParse.success) {
    return NextResponse.json({ error: 'Check-in could not be loaded.' }, { status: 422 });
  }
  const snapshot = snapParse.data;
  if (snapshot.completed) {
    return NextResponse.json(
      { error: 'This check-in has already been submitted.' },
      { status: 409 },
    );
  }

  const body = await parseJson(req, CheckinSubmitInputSchema);
  if (!body.ok) return body.response;

  const def = INSTRUMENTS[snapshot.instrumentKey];
  if (!def) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 422 });
  }
  const language: ClinicalLocale = ClinicalLocaleSchema.safeParse(share.language).success
    ? (share.language as ClinicalLocale)
    : 'en';

  let scored;
  try {
    scored = scoreInstrument(def, body.value.responses, language);
  } catch (e) {
    if (e instanceof InstrumentScoringError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }

  const now = new Date();
  const meta = auditMetadataFromRequest(req);

  const committed = await prisma
    .$transaction(async (tx) => {
      await lockShareFamily(tx, share);
      const current = await tx.patientShare.findUnique({
        where: { id: share.id },
        select: { snapshot: true, status: true, expiresAt: true, resendOfId: true },
      });
      const currentSnapshot = InstrumentCheckinSnapshotSchema.safeParse(current?.snapshot);
      if (!current || !['SENT', 'OPENED'].includes(current.status)) {
        throw new CheckinWithdrawnError();
      }
      if (!(await activeShareAncestors(tx, current.resendOfId))) {
        throw new CheckinWithdrawnError();
      }
      if (current.expiresAt <= now || !currentSnapshot.success || currentSnapshot.data.completed) {
        throw new CheckinReplayError();
      }
      const siblings = await tx.patientShare.findMany({
        where: {
          ...(share.shareBatchId ? { shareBatchId: share.shareBatchId } : { id: share.id }),
          status: { in: ['SENT', 'OPENED'] },
        },
        select: { id: true, snapshot: true, status: true },
      });
      if (
        siblings.some((sibling) => {
          const parsed = InstrumentCheckinSnapshotSchema.safeParse(sibling.snapshot);
          return parsed.success && parsed.data.completed;
        })
      )
        throw new CheckinReplayError();
      const row = await tx.instrumentResponse.create({
        data: {
          clientId: share.clientId,
          psychologistId: share.psychologistId,
          sessionId: share.sessionId,
          sourcePatientShareId: share.id,
          sourceShareBatchId: share.shareBatchId ?? share.id,
          instrumentKey: def.key,
          language,
          responses: body.value.responses as unknown as Prisma.InputJsonValue,
          score: scored.score,
          severity: scored.severityKey,
          // CLIN-1 — persist the safety bit on the record, not just the
          // audit log, so a remote suicidality endorsement is queryable by
          // the crisis pathway + the therapist alert below.
          riskFlagged: scored.riskFlagged,
          administeredAt: now,
          // No clinician administered it; attribute to the owning
          // therapist (who sent it) but mark the mode SELF.
          administeredByPsychologistId: share.psychologistId,
          administrationMode: 'SELF',
        },
      });

      // Mark the share completed so re-opening shows a thank-you, not a
      // blank form, and the in-session "already sent" UI can tell.
      for (const sibling of siblings) {
        if (sibling.status === 'REVOKED') continue;
        const siblingSnapshot = InstrumentCheckinSnapshotSchema.safeParse(sibling.snapshot);
        if (!siblingSnapshot.success) continue;
        const changed = await tx.patientShare.updateMany({
          where: { id: sibling.id, status: { in: ['SENT', 'OPENED'] } },
          data: {
            snapshot: {
              ...siblingSnapshot.data,
              completed: true,
              completedAt: now.toISOString(),
            } as unknown as Prisma.InputJsonValue,
            ...(sibling.id === share.id && sibling.status === 'SENT'
              ? { status: 'OPENED', openedAt: now }
              : {}),
          },
        });
        if (sibling.id === share.id && changed.count !== 1) throw new CheckinWithdrawnError();
      }

      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'PATIENT_CHECKIN_SUBMITTED',
          targetType: 'InstrumentResponse',
          targetId: row.id,
          metadata: {
            ...meta,
            clientId: share.clientId,
            psychologistId: share.psychologistId,
            outcome: 'recorded',
          },
        },
        tx,
      );

      // Safety net — a self-harm endorsement on a remote check-in must
      // reach the therapist's crisis pathway, not sit silently in a trend.
      if (scored.riskFlagged) {
        await writeAudit(
          {
            actorType: 'CLIENT',
            action: 'CRISIS_FLAG_RAISED',
            targetType: 'InstrumentResponse',
            targetId: row.id,
            metadata: {
              ...meta,
              clientId: share.clientId,
              psychologistId: share.psychologistId,
              source: 'self_checkin',
              outcome: 'raised',
            },
          },
          tx,
        );
      }
      let alertAttemptId: string | null = null;
      if (scored.riskFlagged) {
        const alertAttempt = await tx.crisisAlertAttempt.create({
          data: {
            instrumentResponseId: row.id,
            psychologistId: share.psychologistId,
            clientId: share.clientId,
          },
          select: { id: true },
        });
        alertAttemptId = alertAttempt.id;
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'THERAPIST_CRISIS_ALERTED',
            targetType: 'CrisisAlertAttempt',
            targetId: alertAttempt.id,
            metadata: {
              clientId: share.clientId,
              psychologistId: share.psychologistId,
              source: 'self_checkin',
              channel: 'email',
              outcome: 'intent_recorded',
            },
          },
          tx,
        );
      }
      return { alertAttemptId };
    })
    .catch((error: unknown) => {
      if (error instanceof CheckinReplayError) return false;
      if (error instanceof CheckinWithdrawnError) return 'WITHDRAWN' as const;
      throw error;
    });
  if (committed === 'WITHDRAWN') {
    return NextResponse.json({ error: 'Check-in not found' }, { status: 404 });
  }
  if (!committed) {
    return NextResponse.json(
      { error: 'This check-in has already been submitted.' },
      { status: 409 },
    );
  }

  const alertAttemptId = typeof committed === 'object' ? committed.alertAttemptId : null;
  if (alertAttemptId) {
    // Best-effort low-latency kick only. The cron/worker owns durability and
    // will independently claim any PENDING attempt after request termination.
    void processCrisisAlertOutbox({ ids: [alertAttemptId], limit: 1 }).catch(() => {
      console.error('[checkin] CRISIS_ALERT_OUTBOX_KICK_FAILED');
    });
  }

  // Minimal response — no score / severity echoed back to the client.
  // riskFlagged lets the portal keep crisis resources on the thank-you.
  return NextResponse.json({ ok: true, riskFlagged: scored.riskFlagged });
}

class CheckinReplayError extends Error {}
class CheckinWithdrawnError extends Error {}

async function activeShareAncestors(
  tx: Prisma.TransactionClient,
  parentId: string | null,
): Promise<boolean> {
  let cursor = parentId;
  while (cursor) {
    const parent = await tx.patientShare.findUnique({
      where: { id: cursor },
      select: { status: true, resendOfId: true },
    });
    if (!parent || !isUsableResendAncestorStatus(parent.status)) return false;
    cursor = parent.resendOfId;
  }
  return true;
}
