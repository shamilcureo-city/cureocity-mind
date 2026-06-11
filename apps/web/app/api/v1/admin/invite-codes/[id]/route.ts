import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toInviteCode } from '@/lib/invite';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/v1/admin/invite-codes/[id] — revoke a code (admin).
 *
 * Soft revoke (sets revokedAt) so the audit trail + already-seated
 * signups stay intact; a revoked code can no longer be redeemed.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const existing = await prisma.pilotInviteCode.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Invite code not found' }, { status: 404 });
  if (existing.revokedAt) {
    return NextResponse.json({ inviteCode: toInviteCode(existing) });
  }

  const row = await prisma.pilotInviteCode.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'PILOT_INVITE_REVOKED',
    targetType: 'PilotInviteCode',
    targetId: id,
    metadata: { ...auditMetadataFromRequest(req), code: row.code },
  });
  return NextResponse.json({ inviteCode: toInviteCode(row) });
}
