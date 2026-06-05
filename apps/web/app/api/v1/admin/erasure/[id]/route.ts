import { NextResponse, type NextRequest } from 'next/server';
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
 *                           soft-deletes the Client (sets
 *                           deletedAt) AND nulls the contact PII
 *                           fields. Hard-delete of session content
 *                           runs via the audio-retention cron and
 *                           a future Sprint 10 PII-purge job.
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
    return NextResponse.json(
      { error: `Cannot APPROVE from ${existing.status}` },
      { status: 422 },
    );
  }
  if (
    body.value.status === 'REJECTED' &&
    existing.status !== 'PENDING'
  ) {
    return NextResponse.json(
      { error: `Cannot REJECT from ${existing.status}` },
      { status: 422 },
    );
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
      await tx.client.update({
        where: { id: existing.client.id },
        data: {
          deletedAt: now,
          contactPhone: 'redacted',
          contactEmail: null,
          presentingConcerns: null,
        },
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
