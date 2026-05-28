import { NextResponse, type NextRequest } from 'next/server';
import type { ClientClaimToken } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { generateClaimToken } from '@/lib/claim-token';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_TTL_DAYS = 14;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/clients/:id/claim-token — issues a single-use token
 * for QR pairing. Ported from
 * services/patient-model-service/src/claim-tokens/claim-tokens.service.ts.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await ctx.params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, clientFirebaseUid: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.clientFirebaseUid !== null) {
    return NextResponse.json(
      { error: 'Client is already paired to a Firebase identity' },
      { status: 409 },
    );
  }

  const token = generateClaimToken();
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.clientClaimToken.create({
      data: {
        clientId,
        psychologistId: auth.value.psychologistId,
        token,
        expiresAt,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLIENT_CLAIM_TOKEN_ISSUED',
        targetType: 'ClientClaimToken',
        targetId: created.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          expiresAt: expiresAt.toISOString(),
        },
      },
      tx,
    );
    return created;
  });

  const body: ClientClaimToken = {
    token: row.token,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    expiresAt: row.expiresAt.toISOString(),
  };
  return NextResponse.json(body, { status: 201 });
}
