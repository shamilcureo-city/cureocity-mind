import { NextResponse, type NextRequest } from 'next/server';
import { AdminSetRoleInputSchema } from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/accounts/[id]/role — grant or revoke the ADMIN role.
 * Admin-gated. Two guards protect against lock-out: an admin cannot change
 * their OWN role, and the LAST remaining admin cannot be demoted. Grant
 * writes `ADMIN_ROLE_GRANTED`, revoke writes `ADMIN_ROLE_REVOKED` (two
 * literal writers so the audit-coverage chaos test sees both).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await parseJson(req, AdminSetRoleInputSchema);
  if (!body.ok) return body.response;

  if (id === auth.value.psychologistId) {
    return NextResponse.json(
      { error: 'You cannot change your own role — ask another admin.' },
      { status: 409 },
    );
  }

  const target = await prisma.psychologist.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, role: true, email: true },
  });
  if (!target) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const nextRole = body.value.role;
  if (target.role === nextRole) {
    return NextResponse.json({ ok: true, role: nextRole, unchanged: true });
  }

  // Never leave the platform with zero admins.
  if (nextRole === 'THERAPIST') {
    const adminCount = await prisma.psychologist.count({
      where: { role: 'ADMIN', deletedAt: null },
    });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot revoke the last admin — grant another admin first.' },
        { status: 409 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.psychologist.update({ where: { id }, data: { role: nextRole } });
    const meta = {
      ...auditMetadataFromRequest(req),
      targetEmail: target.email,
      before: target.role,
      after: nextRole,
    };
    if (nextRole === 'ADMIN') {
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'ADMIN_ROLE_GRANTED',
          targetType: 'Psychologist',
          targetId: id,
          metadata: meta,
        },
        tx,
      );
    } else {
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'ADMIN_ROLE_REVOKED',
          targetType: 'Psychologist',
          targetId: id,
          metadata: meta,
        },
        tx,
      );
    }
  });

  return NextResponse.json({ ok: true, role: nextRole });
}
