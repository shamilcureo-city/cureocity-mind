import { NextResponse, type NextRequest } from 'next/server';
import { DsrConsentWithdrawalInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/dsr/consent-withdrawal — DPDP § 13 Right
 * to Withdraw Consent. Marks the most recent active Consent row for
 * the given scope as withdrawn. Per DPDP, withdrawal is not
 * retroactive — past processing remains lawful, but no further
 * processing under that scope is permitted from this timestamp on.
 * Downstream services check Consent.status before each new run.
 *
 * 404 if no active consent exists for the scope (nothing to withdraw).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const body = await parseJson(req, DsrConsentWithdrawalInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const active = await prisma.consent.findFirst({
    where: { clientId, scope: body.value.scope, status: 'GRANTED', withdrawnAt: null },
    orderBy: { grantedAt: 'desc' },
  });
  if (!active) {
    return NextResponse.json(
      { error: `No active consent for scope ${body.value.scope}` },
      { status: 404 },
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
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'DSR_CONSENT_WITHDRAWN',
        targetType: 'Consent',
        targetId: active.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          onBehalfOf: clientId,
          scope: body.value.scope,
          ...(body.value.reason && { reason: body.value.reason }),
        },
      },
      tx,
    );
  });

  return new NextResponse(null, { status: 204 });
}
