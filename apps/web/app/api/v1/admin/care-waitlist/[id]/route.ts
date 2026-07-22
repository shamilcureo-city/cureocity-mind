import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/v1/admin/care-waitlist/[id] — remove a Care waitlist entry
 * (spam, duplicate, or a request to be taken off). Admin-gated. The audit
 * row `CARE_WAITLIST_REMOVED` records the contact hash of the removed entry
 * so the removal is provable without keeping the raw contact.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const entry = await prisma.careWaitlistEntry.findUnique({
    where: { id },
    select: { id: true, invitedAt: true },
  });
  if (!entry) return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.careWaitlistEntry.delete({ where: { id } });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CARE_WAITLIST_REMOVED',
        targetType: 'CareWaitlistEntry',
        targetId: id,
        metadata: { ...auditMetadataFromRequest(req), wasInvited: entry.invitedAt !== null },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
