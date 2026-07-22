import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { AdminSetRoleInputSchema } from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

/** Thrown inside the tx to abort a demotion that would leave zero admins. */
class LastAdminError extends Error {}

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

  // The "never leave the platform with zero admins" check and the demotion
  // must be ATOMIC — a pre-transaction count is a TOCTOU (two admins demoting
  // each other concurrently could both read count=2 and both commit → zero
  // admins). Re-check the count INSIDE a Serializable transaction. Review fix.
  const meta = {
    ...auditMetadataFromRequest(req),
    targetEmail: target.email,
    before: target.role,
    after: nextRole,
  };
  try {
    await prisma.$transaction(
      async (tx) => {
        if (nextRole === 'THERAPIST') {
          const adminCount = await tx.psychologist.count({
            where: { role: 'ADMIN', deletedAt: null },
          });
          if (adminCount <= 1) throw new LastAdminError();
        }
        await tx.psychologist.update({ where: { id }, data: { role: nextRole } });
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof LastAdminError) {
      return NextResponse.json(
        { error: 'Cannot revoke the last admin — grant another admin first.' },
        { status: 409 },
      );
    }
    // A serialization conflict (concurrent demotion) fails closed here rather
    // than risking the zero-admin state — safe: the operator can retry.
    throw e;
  }

  return NextResponse.json({ ok: true, role: nextRole });
}
