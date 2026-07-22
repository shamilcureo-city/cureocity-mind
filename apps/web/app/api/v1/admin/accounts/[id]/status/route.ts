import { NextResponse, type NextRequest } from 'next/server';
import { AdminSetStatusInputSchema } from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/accounts/[id]/status — set an account's lifecycle
 * status (PENDING_VERIFICATION → ACTIVE on verification, or SUSPENDED /
 * OFFBOARDED). Admin-gated. An admin cannot suspend their own account.
 * Audited `ADMIN_ACCOUNT_STATUS_CHANGED`. NOTE: this does not sign the
 * user out or delete data — it's a status marker; enforcement of SUSPENDED
 * at the auth layer is a follow-up (tracked in the console notes).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await parseJson(req, AdminSetStatusInputSchema);
  if (!body.ok) return body.response;

  if (id === auth.value.psychologistId) {
    return NextResponse.json(
      { error: 'You cannot change your own account status.' },
      { status: 409 },
    );
  }

  const target = await prisma.psychologist.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, email: true },
  });
  if (!target) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const nextStatus = body.value.status;
  if (target.status === nextStatus) {
    return NextResponse.json({ ok: true, status: nextStatus, unchanged: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.psychologist.update({ where: { id }, data: { status: nextStatus } });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'ADMIN_ACCOUNT_STATUS_CHANGED',
        targetType: 'Psychologist',
        targetId: id,
        metadata: {
          ...auditMetadataFromRequest(req),
          targetEmail: target.email,
          before: target.status,
          after: nextStatus,
          reason: body.value.reason ?? null,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
