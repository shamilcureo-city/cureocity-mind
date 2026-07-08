import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

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
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
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
    },
  });
  if (!share || share.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  }

  // Already revoked — idempotent no-op so a double-click / retry is safe.
  if (share.status === 'REVOKED') {
    return NextResponse.json({ id: share.id, status: 'REVOKED' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.patientShare.update({
      where: { id: share.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
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
          previousStatus: share.status,
          ...auditMetadataFromRequest(req),
        },
      },
      tx,
    );
  });

  return NextResponse.json({ id: share.id, status: 'REVOKED' });
}
