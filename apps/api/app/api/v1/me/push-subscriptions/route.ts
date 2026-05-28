import { NextResponse, type NextRequest } from 'next/server';
import {
  RegisterPushSubscriptionInputSchema,
  type PushSubscriptionRecord,
} from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/me/push-subscriptions — upsert by endpoint (resubscribe
 * rotates keys + clears revokedAt).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, RegisterPushSubscriptionInputSchema);
  if (!dto.ok) return dto.response;
  const clientId = auth.value.clientId;

  const row = await prisma.$transaction(async (tx) => {
    const upserted = await tx.clientPushSubscription.upsert({
      where: { endpoint: dto.value.endpoint },
      create: {
        clientId,
        endpoint: dto.value.endpoint,
        p256dh: dto.value.keys.p256dh,
        auth: dto.value.keys.auth,
        userAgent: dto.value.userAgent ?? null,
      },
      update: {
        clientId,
        p256dh: dto.value.keys.p256dh,
        auth: dto.value.keys.auth,
        userAgent: dto.value.userAgent ?? null,
        revokedAt: null,
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'PUSH_SUBSCRIPTION_REGISTERED',
        targetType: 'ClientPushSubscription',
        targetId: upserted.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          ...(dto.value.userAgent !== undefined && { userAgent: dto.value.userAgent }),
        },
      },
      tx,
    );
    return upserted;
  });

  const body: PushSubscriptionRecord = {
    id: row.id,
    endpoint: row.endpoint,
    userAgent: row.userAgent,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
  return NextResponse.json(body, { status: 201 });
}
