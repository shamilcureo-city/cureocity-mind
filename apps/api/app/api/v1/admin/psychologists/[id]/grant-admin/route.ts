import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/admin/psychologists/:id/grant-admin — upgrades a
 * psychologist to ADMIN role. Out-of-band promotion path; the
 * receiver acquires audit-log read + DSR resolver privileges.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id: targetId } = await ctx.params;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.psychologist.update({
      where: { id: targetId },
      data: { role: 'ADMIN' },
      select: { id: true, role: true },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'ADMIN_ROLE_GRANTED',
        targetType: 'Psychologist',
        targetId: updated.id,
        metadata: { ...auditMetadataFromRequest(req), newRole: 'ADMIN' },
      },
      tx,
    );
  });
  return new NextResponse(null, { status: 204 });
}
