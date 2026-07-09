import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'FULFILLED']),
  resolutionNotes: z.string().max(2000).optional(),
});

/**
 * PATCH /api/v1/admin/erasure/[id] — therapist-as-admin resolves a
 * ClientErasureRequest. Allowed transitions from PENDING:
 *
 *   PENDING → REJECTED      records reason in resolutionNotes;
 *                           client data stays intact.
 *   PENDING → APPROVED      acknowledges approval; client data
 *                           remains until FULFILLED. Therapist
 *                           uses this state when there are still
 *                           clinical obligations (open scripts,
 *                           statutory hold).
 *   PENDING → FULFILLED     direct fulfilment for clean cases —
 *                           soft-deletes the Client (sets deletedAt),
 *                           redacts the name + contact PII, AND (SEC-2)
 *                           redacts every PII/PHI-bearing column across
 *                           the client's session content in the same
 *                           transaction: transcripts, notes, diagnoses,
 *                           plans, instrument answers, raw audio bytes,
 *                           and patient-share snapshots. Rows are kept
 *                           (soft-deleted) so the erasure stays auditable
 *                           and referential integrity holds.
 *   APPROVED → FULFILLED    same fulfilment action after delayed
 *                           approval.
 *
 * Audits as DSR_ERASURE_FULFILLED on the final fulfilment write so
 * the regulator can prove the 30-day clock was honoured.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, PatchSchema);
  if (!body.ok) return body.response;

  const existing = await prisma.clientErasureRequest.findUnique({
    where: { id },
    include: { client: { select: { id: true, psychologistId: true, deletedAt: true } } },
  });
  if (!existing || existing.client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  // Guard transitions
  if (existing.status === 'FULFILLED') {
    return NextResponse.json({ error: 'Already FULFILLED' }, { status: 409 });
  }
  if (existing.status === 'REJECTED') {
    return NextResponse.json({ error: 'Already REJECTED' }, { status: 409 });
  }
  if (body.value.status === 'APPROVED' && existing.status !== 'PENDING') {
    return NextResponse.json({ error: `Cannot APPROVE from ${existing.status}` }, { status: 422 });
  }
  if (body.value.status === 'REJECTED' && existing.status !== 'PENDING') {
    return NextResponse.json({ error: `Cannot REJECT from ${existing.status}` }, { status: 422 });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.clientErasureRequest.update({
      where: { id },
      data: {
        status: body.value.status,
        resolvedAt: now,
        resolvedByPsychologistId: auth.value.psychologistId,
        ...(body.value.resolutionNotes !== undefined && {
          resolutionNotes: body.value.resolutionNotes,
        }),
      },
    });

    if (body.value.status === 'FULFILLED') {
      const clientId = existing.client.id;
      await tx.client.update({
        where: { id: clientId },
        data: {
          deletedAt: now,
          // SEC-2 — the fullName is the PRIMARY identifier; null the encrypted
          // column so a decrypt-on-read can't resurrect the erased name.
          fullNameEncrypted: null,
          contactPhoneEncrypted: null,
          contactEmailEncrypted: null,
          presentingConcerns: null,
        },
      });

      // SEC-2 — a DPDP erasure must also remove the PII/PHI that lives in the
      // client's session content, not just the Client row. We keep the (soft-
      // deleted) rows so the erasure itself stays auditable + referential
      // integrity holds, but REDACT every PII/PHI-bearing column in place:
      // transcripts, notes, diagnoses, plans, instrument answers, raw audio,
      // and patient-share snapshots.
      const clientSessions = await tx.session.findMany({
        where: { clientId },
        select: { id: true },
      });
      const sessionIds = clientSessions.map((s) => s.id);
      const therapyNotes = await tx.therapyNote.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true },
      });
      const therapyNoteIds = therapyNotes.map((n) => n.id);

      // Free-standing PII rows — deleting is cleanest (no dependents).
      await tx.letter.deleteMany({ where: { clientId } });
      await tx.problemListItem.deleteMany({ where: { clientId } });
      if (sessionIds.length > 0) {
        await tx.noteReview.deleteMany({ where: { sessionId: { in: sessionIds } } });
      }

      if (sessionIds.length > 0) {
        // Raw voice recording — biometric-grade PII (was purged only by the
        // 30-day cron; force it here).
        await tx.audioChunk.updateMany({
          where: { sessionId: { in: sessionIds } },
          data: { bytes: null },
        });
        await tx.transcriptSegment.updateMany({
          where: { sessionId: { in: sessionIds } },
          data: {
            transcript: null,
            speakerSegments: Prisma.DbNull,
            affectFeatures: Prisma.DbNull,
            errorMessage: null,
          },
        });
        await tx.noteDraft.updateMany({
          where: { sessionId: { in: sessionIds } },
          data: {
            transcript: null,
            transcriptEncrypted: null,
            speakerSegments: Prisma.DbNull,
            affectFeatures: Prisma.DbNull,
            content: Prisma.DbNull,
            rxPad: Prisma.DbNull,
            errorMessage: null,
          },
        });
        await tx.therapyNote.updateMany({
          where: { sessionId: { in: sessionIds } },
          data: { content: {}, rxPad: Prisma.DbNull },
        });
      }
      if (therapyNoteIds.length > 0) {
        await tx.noteEdit.updateMany({
          where: { therapyNoteId: { in: therapyNoteIds } },
          data: { before: 'redacted', after: 'redacted' },
        });
      }
      // Client-keyed clinical PHI.
      await tx.clinicalReport.updateMany({
        where: { clientId },
        data: { body: Prisma.DbNull, confirmations: {}, errorMessage: null },
      });
      await tx.clientDiagnosis.updateMany({
        where: { clientId },
        data: { supportingEvidence: [], notes: null },
      });
      await tx.treatmentPlan.updateMany({ where: { clientId }, data: { body: {} } });
      await tx.instrumentResponse.updateMany({
        where: { clientId },
        data: { responses: {}, notes: null },
      });
      await tx.preSessionBrief.updateMany({
        where: { clientId },
        data: { body: Prisma.DbNull, errorMessage: null },
      });
      await tx.therapyScript.updateMany({ where: { clientId }, data: { body: {} } });
      // Patient-share snapshots freeze the client's name + note text + contact.
      await tx.patientShare.updateMany({
        where: { clientId },
        data: { snapshot: {}, toContact: null, subject: 'redacted', errorDetail: null },
      });

      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'CLIENT_SOFT_DELETED',
          targetType: 'Client',
          targetId: existing.client.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            cause: 'DSR_ERASURE',
            erasureRequestId: id,
          },
        },
        tx,
      );
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'DSR_ERASURE_FULFILLED',
          targetType: 'ClientErasureRequest',
          targetId: id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: existing.client.id,
            ...(body.value.resolutionNotes && { resolutionNotes: body.value.resolutionNotes }),
          },
        },
        tx,
      );
    } else {
      // APPROVED or REJECTED: just audit the decision; no data
      // mutations beyond the request row itself.
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action:
            body.value.status === 'APPROVED'
              ? 'DSR_ERASURE_FULFILLED' // approval is part of the fulfilment chain
              : 'DSR_ERASURE_REQUESTED',
          targetType: 'ClientErasureRequest',
          targetId: id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: existing.client.id,
            transition: `${existing.status} -> ${body.value.status}`,
            ...(body.value.resolutionNotes && { resolutionNotes: body.value.resolutionNotes }),
          },
        },
        tx,
      );
    }
  });

  return NextResponse.json({ id, status: body.value.status, resolvedAt: now.toISOString() });
}
