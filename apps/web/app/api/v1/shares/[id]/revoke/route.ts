import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { privateJson, privateResponse } from '@/lib/private-response';
import { lockShareFamily } from '@/lib/share-family-lock';
import { activeShareSubmissionWhere } from '@/lib/sprint5-final-behavior';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SHARE-1 — POST /api/v1/shares/:id/revoke
 *
 * Pull back a shared patient link (wrong recipient / wrong artefact). Flips
 * the share to the terminal REVOKED status + stamps revokedAt; from then on
 * the portal refuses to render the artefact and stops auditing opens.
 *
 * POST-only (a side effect must never be reachable by a prefetched GET —
 * see docs/AUTH_SESSION.md). Tenant-checked. Idempotent: revoking an
 * already-revoked share is a no-op success.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCapability(req, 'PATIENT_SHARING');
  if (!auth.ok) return privateResponse(auth.response);
  const { id } = await params;

  const share = await prisma.patientShare.findUnique({
    where: { id },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      status: true,
      artefactType: true,
      channel: true,
      shareBatchId: true,
    },
  });
  if (!share || share.psychologistId !== auth.value.psychologistId) {
    return privateJson({ error: 'Share not found' }, { status: 404 });
  }

  // Only an active delivery (or an already-revoked root whose resend
  // descendants still need closing) can be revoked. Failed attempts remain
  // immutable receipts and cannot be disguised as successful withdrawals.
  if (share.status !== 'SENT' && share.status !== 'OPENED' && share.status !== 'REVOKED') {
    return privateJson({ error: 'Share is not active' }, { status: 409 });
  }

  const revoked = await prisma.$transaction(async (tx) => {
    await lockShareFamily(tx, share);
    const current = await tx.patientShare.findUnique({
      where: { id: share.id },
      select: { status: true },
    });
    if (!current) return false;
    if (current.status !== 'SENT' && current.status !== 'OPENED' && current.status !== 'REVOKED')
      return false;
    const descendantIds = await collectShareDescendantIds(tx, share.id, auth.value.psychologistId);
    const submissionInFlight = await tx.patientShare.findFirst({
      where: {
        id: { in: [share.id, ...descendantIds] },
        ...activeShareSubmissionWhere(),
      },
      select: { id: true },
    });
    if (submissionInFlight) return 'SUBMISSION_IN_FLIGHT' as const;
    const changed = await tx.patientShare.updateMany({
      where: {
        id: { in: [share.id, ...descendantIds] },
        status: { in: ['PENDING', 'SENT', 'OPENED'] },
      },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (changed.count === 0) return current.status === 'REVOKED';
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'PATIENT_SHARE_REVOKED',
        targetType: 'PatientShare',
        targetId: share.id,
        metadata: {
          clientId: share.clientId,
          artefactType: share.artefactType,
          channel: share.channel,
          previousStatus: current.status,
          ...auditMetadataFromRequest(req),
        },
      },
      tx,
    );
    return true;
  });
  if (revoked === 'SUBMISSION_IN_FLIGHT') {
    return privateJson(
      { error: 'Share withdrawal is blocked while provider submission is in progress.' },
      { status: 409 },
    );
  }
  if (!revoked) return privateJson({ error: 'Share is not active' }, { status: 409 });

  return privateJson({ id: share.id, status: 'REVOKED' });
}

async function collectShareDescendantIds(
  tx: Prisma.TransactionClient,
  rootId: string,
  psychologistId: string,
): Promise<string[]> {
  const seen = new Set<string>();
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await tx.patientShare.findMany({
      where: { resendOfId: { in: frontier }, psychologistId },
      select: { id: true },
    });
    frontier = children.map((child) => child.id).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  return [...seen];
}
