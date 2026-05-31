import { NextResponse, type NextRequest } from 'next/server';
import { resolveClient } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** DELETE /api/v1/me/push-subscriptions/:id — soft-revoke (sets revokedAt). */
export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const row = await prisma.clientPushSubscription.findUnique({
    where: { id },
    select: { id: true, clientId: true },
  });
  if (!row || row.clientId !== auth.value.clientId) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.clientPushSubscription.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'PUSH_SUBSCRIPTION_REVOKED',
        targetType: 'ClientPushSubscription',
        targetId: id,
        metadata: { ...auditMetadataFromRequest(req), clientId: auth.value.clientId },
      },
      tx,
    );
  });
  return new NextResponse(null, { status: 204 });
}
