import { NextResponse, type NextRequest } from 'next/server';
import { AdminWaitlistInviteInputSchema } from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/care-waitlist/[id]/invite — mark a Care waitlist entry
 * invited (stamps `invitedAt`, keeps the row for the record). Admin-gated.
 * Audited `CARE_WAITLIST_INVITED`. Sending the actual invite (WhatsApp/email)
 * is a follow-up — this records the decision.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await parseJson(req, AdminWaitlistInviteInputSchema);
  if (!body.ok) return body.response;

  const entry = await prisma.careWaitlistEntry.findUnique({ where: { id }, select: { id: true } });
  if (!entry) return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 });

  const invitedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.careWaitlistEntry.update({
      where: { id },
      data: { invitedAt, notes: body.value.notes ?? undefined },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CARE_WAITLIST_INVITED',
        targetType: 'CareWaitlistEntry',
        targetId: id,
        metadata: { ...auditMetadataFromRequest(req), notes: body.value.notes ?? null },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true, invitedAt: invitedAt.toISOString() });
}
