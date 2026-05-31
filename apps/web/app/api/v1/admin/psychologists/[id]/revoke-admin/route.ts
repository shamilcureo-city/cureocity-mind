import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/admin/psychologists/:id/revoke-admin — downgrades to
 * THERAPIST.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id: targetId } = await ctx.params;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.psychologist.update({
      where: { id: targetId },
      data: { role: 'THERAPIST' },
      select: { id: true, role: true },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'ADMIN_ROLE_REVOKED',
        targetType: 'Psychologist',
        targetId: updated.id,
        metadata: { ...auditMetadataFromRequest(req), newRole: 'THERAPIST' },
      },
      tx,
    );
  });
  return new NextResponse(null, { status: 204 });
}
