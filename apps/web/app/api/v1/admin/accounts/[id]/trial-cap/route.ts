import { NextResponse, type NextRequest } from 'next/server';
import { AdminSetTrialCapInputSchema } from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { ensureBillingAccount } from '@/lib/billing';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/admin/accounts/[id]/trial-cap — set an account's free-trial
 * session cap (BillingAccount.trialSessionCap). Admin-gated. Useful to
 * extend a promising pilot's runway without comping them to a paid tier.
 * Audited `ADMIN_TRIAL_CAP_ADJUSTED`.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await parseJson(req, AdminSetTrialCapInputSchema);
  if (!body.ok) return body.response;

  const target = await prisma.psychologist.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!target) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  await ensureBillingAccount(id);
  const cap = body.value.cap;

  await prisma.$transaction(async (tx) => {
    const before = await tx.billingAccount.findUnique({
      where: { psychologistId: id },
      select: { trialSessionCap: true },
    });
    await tx.billingAccount.update({
      where: { psychologistId: id },
      data: { trialSessionCap: cap },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'ADMIN_TRIAL_CAP_ADJUSTED',
        targetType: 'Psychologist',
        targetId: id,
        metadata: {
          ...auditMetadataFromRequest(req),
          targetEmail: target.email,
          before: before?.trialSessionCap ?? null,
          after: cap,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true, trialSessionCap: cap });
}
