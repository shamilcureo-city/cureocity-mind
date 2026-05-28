import { NextResponse, type NextRequest } from 'next/server';
import type { ClaimTokenRedeemResult } from '@cureocity/contracts';
import { resolveFirebaseUidOnly } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { firstName } from '@/lib/claim-token';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * POST /api/v1/claim-tokens/:token/redeem — Firebase-auth (uid only,
 * no Client row required), idempotent per uid. Sets
 * Client.clientFirebaseUid + writes CLIENT_CLAIM_TOKEN_REDEEMED and
 * CLIENT_FIREBASE_LINKED audit rows.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const uidRes = await resolveFirebaseUidOnly(req);
  if (!uidRes.ok) return uidRes.response;
  const firebaseUid = uidRes.value;
  const { token } = await ctx.params;

  const row = await prisma.clientClaimToken.findUnique({
    where: { token },
    include: {
      client: {
        select: {
          id: true,
          fullName: true,
          clientFirebaseUid: true,
          psychologist: { select: { fullName: true } },
        },
      },
    },
  });
  if (!row) return NextResponse.json({ error: 'Claim token not found' }, { status: 404 });
  if (row.expiresAt <= new Date()) {
    return NextResponse.json({ error: 'Claim token has expired' }, { status: 400 });
  }

  if (row.redeemedAt && row.redeemedByFirebaseUid === firebaseUid) {
    const body: ClaimTokenRedeemResult = {
      clientId: row.clientId,
      clientFirstName: firstName(row.client.fullName),
      psychologistFullName: row.client.psychologist.fullName,
      redeemedAt: row.redeemedAt.toISOString(),
    };
    return NextResponse.json(body);
  }
  if (row.redeemedAt) {
    return NextResponse.json(
      { error: 'Claim token has already been redeemed by a different account' },
      { status: 409 },
    );
  }
  if (row.client.clientFirebaseUid !== null && row.client.clientFirebaseUid !== firebaseUid) {
    return NextResponse.json(
      { error: 'Client is already paired to a different Firebase identity' },
      { status: 409 },
    );
  }

  const redeemedAt = new Date();
  await prisma.$transaction(async (tx) => {
    if (row.client.clientFirebaseUid !== firebaseUid) {
      await tx.client.update({
        where: { id: row.clientId },
        data: { clientFirebaseUid: firebaseUid },
      });
    }
    const updated = await tx.clientClaimToken.update({
      where: { id: row.id },
      data: { redeemedAt, redeemedByFirebaseUid: firebaseUid },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CLIENT_CLAIM_TOKEN_REDEEMED',
        targetType: 'ClientClaimToken',
        targetId: updated.id,
        metadata: { ...auditMetadataFromRequest(req), clientId: row.clientId, firebaseUid },
      },
      tx,
    );
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CLIENT_FIREBASE_LINKED',
        targetType: 'Client',
        targetId: row.clientId,
        metadata: {
          ...auditMetadataFromRequest(req),
          firebaseUid,
          tokenId: updated.id,
        },
      },
      tx,
    );
  });

  const body: ClaimTokenRedeemResult = {
    clientId: row.clientId,
    clientFirstName: firstName(row.client.fullName),
    psychologistFullName: row.client.psychologist.fullName,
    redeemedAt: redeemedAt.toISOString(),
  };
  return NextResponse.json(body);
}
