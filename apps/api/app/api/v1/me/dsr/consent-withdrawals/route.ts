import { NextResponse, type NextRequest } from 'next/server';
import { DsrConsentWithdrawalInputSchema } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/me/dsr/consent-withdrawals — DPDP § 13 withdraw
 * consent. Writes DSR_CONSENT_WITHDRAWN + standard CONSENT_WITHDRAWN
 * (the briefing pipeline keys off the standard action).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, DsrConsentWithdrawalInputSchema);
  if (!dto.ok) return dto.response;
  const clientId = auth.value.clientId;

  const active = await prisma.consent.findFirst({
    where: { clientId, scope: dto.value.scope, status: 'GRANTED' },
    orderBy: { grantedAt: 'desc' },
  });
  if (!active) {
    return NextResponse.json(
      { error: `No active consent for scope ${dto.value.scope}` },
      { status: 400 },
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.consent.update({
      where: { id: active.id },
      data: { status: 'WITHDRAWN', withdrawnAt: now },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'DSR_CONSENT_WITHDRAWN',
        targetType: 'Consent',
        targetId: active.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          scope: dto.value.scope,
          ...(dto.value.reason !== undefined && { reason: dto.value.reason }),
        },
      },
      tx,
    );
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CONSENT_WITHDRAWN',
        targetType: 'Consent',
        targetId: active.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          scope: dto.value.scope,
          viaDsr: true,
        },
      },
      tx,
    );
  });
  return new NextResponse(null, { status: 204 });
}
