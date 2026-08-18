import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { DsrErasureStatus } from '@prisma/client';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { eraseClientPhi } from '@/lib/dpdp-erasure';
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
        await eraseClientPhi(tx, {
          clientId: locked.clientId,
          erasureRequestId: id,
          psychologistId: auth.value.psychologistId,
          now,
        });

        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'CLIENT_SOFT_DELETED',
            targetType: 'Client',
            targetId: locked.clientId,
            metadata: {
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
          resolutionNotes: null,
          resolutionNotesHashHex: resolutionNotesHashHex ?? null,
        },
      });
      if (transitioned.count !== 1) {
        throw new ErasureHttpError(409, 'Erasure decision changed concurrently');
      }

      if (body.value.status === 'FULFILLED') {
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'DSR_ERASURE_FULFILLED',
            targetType: 'ClientErasureRequest',
            targetId: id,
            metadata: {
              transition: `${locked.status} -> FULFILLED`,
              ...(resolutionNotesHashHex && { resolutionNotesHashHex }),
            },
          },
          tx,
        );
      } else if (body.value.status === 'APPROVED') {
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'DSR_ERASURE_APPROVED',
            targetType: 'ClientErasureRequest',
            targetId: id,
            metadata: {
              ...auditMetadataFromRequest(req),
              clientId: locked.clientId,
              transition: `${locked.status} -> APPROVED`,
              ...(resolutionNotesHashHex && { resolutionNotesHashHex }),
            },
          },
          tx,
        );
      } else {
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'DSR_ERASURE_REQUESTED',
            targetType: 'ClientErasureRequest',
            targetId: id,
            metadata: {
              ...auditMetadataFromRequest(req),
              clientId: locked.clientId,
              transition: `${locked.status} -> REJECTED`,
              ...(resolutionNotesHashHex && { resolutionNotesHashHex }),
            },
          },
          tx,
        );
      }
    });
  } catch (error) {
    if (error instanceof ErasureHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  return NextResponse.json({ id, status: body.value.status, resolvedAt: now.toISOString() });
}
