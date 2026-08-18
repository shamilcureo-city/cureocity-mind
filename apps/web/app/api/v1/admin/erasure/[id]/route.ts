import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma, type DsrErasureStatus } from '@prisma/client';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { getMigrationPrisma } from '@/lib/prisma-migration';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'FULFILLED']),
  resolutionNotes: z.string().max(2000).optional(),
});

class ErasureHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type LockedErasure = {
  id: string;
  status: DsrErasureStatus;
  clientId: string;
  psychologistId: string;
};

/** Resolve and, when requested, lawfully redact a DPDP erasure request atomically. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, PatchSchema);
  if (!body.ok) return body.response;

  const now = new Date();
  const resolutionNotesHashHex = body.value.resolutionNotes
    ? createHash('sha256').update(body.value.resolutionNotes).digest('hex')
    : undefined;

  try {
    // This transaction intentionally uses the migration owner. Runtime cannot
    // execute the owner-controlled signed-note erasure function.
    await getMigrationPrisma().$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedErasure[]>`
        SELECT r."id", r."status", r."clientId", c."psychologistId"
        FROM "client_erasure_requests" r
        JOIN "clients" c ON c."id" = r."clientId"
        WHERE r."id" = ${id}
        FOR UPDATE OF r, c
      `;
      const locked = rows[0];
      if (!locked || locked.psychologistId !== auth.value.psychologistId) {
        throw new ErasureHttpError(404, 'Request not found');
      }
      if (locked.status === 'FULFILLED' || locked.status === 'REJECTED') {
        throw new ErasureHttpError(409, `Already ${locked.status}`);
      }
      if (
        (body.value.status === 'APPROVED' || body.value.status === 'REJECTED') &&
        locked.status !== 'PENDING'
      ) {
        throw new ErasureHttpError(422, `Cannot ${body.value.status} from ${locked.status}`);
      }

      if (body.value.status === 'FULFILLED') {
        const clientId = locked.clientId;
        // Mark the terminal state while the shared Client lock is held and
        // before redaction. Later PHI writers acquire this lock and fail their
        // deletedAt recheck; earlier writers must commit before this proceeds.
        await tx.client.update({
          where: { id: clientId },
          data: {
            deletedAt: now,
            fullNameEncrypted: null,
            contactPhoneEncrypted: null,
            contactEmailEncrypted: null,
            presentingConcerns: null,
          },
        });
        // SECURITY DEFINER function owns the only narrowly-scoped exception to
        // append-only signature history and redacts content/rxPad/signPayload.
        await tx.$executeRaw`
          SELECT redact_client_signed_note_phi(${id}, ${auth.value.psychologistId})
        `;
        const sessions = await tx.session.findMany({
          where: { clientId },
          select: { id: true },
        });
        const sessionIds = sessions.map(({ id: sessionId }) => sessionId);
        const notes = await tx.therapyNote.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { id: true },
        });
        const therapyNoteIds = notes.map(({ id: noteId }) => noteId);

        await tx.letter.deleteMany({ where: { clientId } });
        await tx.problemListItem.deleteMany({ where: { clientId } });
        if (sessionIds.length > 0) {
          await tx.noteReview.deleteMany({ where: { sessionId: { in: sessionIds } } });
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
              transcriptEncrypted: null,
              speakerSegments: Prisma.DbNull,
              affectFeatures: Prisma.DbNull,
              content: Prisma.DbNull,
              rxPad: Prisma.DbNull,
              errorMessage: null,
            },
          });
        }
        if (therapyNoteIds.length > 0) {
          await tx.noteEdit.updateMany({
            where: { therapyNoteId: { in: therapyNoteIds } },
            data: { before: 'redacted', after: 'redacted' },
          });
        }
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
            targetId: clientId,
            metadata: {
              ...auditMetadataFromRequest(req),
              cause: 'DSR_ERASURE',
              erasureRequestId: id,
            },
          },
          tx,
        );
      }

      const transitioned = await tx.clientErasureRequest.updateMany({
        where: { id, status: locked.status },
        data: {
          status: body.value.status,
          resolvedAt: now,
          resolvedByPsychologistId: auth.value.psychologistId,
          ...(body.value.resolutionNotes !== undefined && {
            resolutionNotes: body.value.resolutionNotes,
          }),
        },
      });
      if (transitioned.count !== 1) {
        throw new ErasureHttpError(409, 'Erasure decision changed concurrently');
      }

      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          ...(body.value.status === 'FULFILLED' || body.value.status === 'APPROVED'
            ? { action: 'DSR_ERASURE_FULFILLED' as const }
            : { action: 'DSR_ERASURE_REQUESTED' as const }),
          targetType: 'ClientErasureRequest',
          targetId: id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: locked.clientId,
            transition: `${locked.status} -> ${body.value.status}`,
            ...(resolutionNotesHashHex && { resolutionNotesHashHex }),
          },
        },
        tx,
      );
    });
  } catch (error) {
    if (error instanceof ErasureHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  return NextResponse.json({ id, status: body.value.status, resolvedAt: now.toISOString() });
}
