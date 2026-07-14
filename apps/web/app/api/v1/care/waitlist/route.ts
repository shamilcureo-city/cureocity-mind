import { NextResponse, type NextRequest } from 'next/server';
import { CareWaitlistInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * P3 — POST /api/v1/care/waitlist — the Care landing's public waitlist.
 *
 * Sign-ups stay gated until the launch blockers clear (token architecture
 * + consumer legal surface), so the front door captures intent instead:
 * one contact string per row, idempotent on re-submits. Public and
 * unauthenticated by design — the only thing it can do is add a row to
 * the waitlist table.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const input = await parseJson(req, CareWaitlistInputSchema);
  if (!input.ok) return input.response;

  const contact = input.value.contact.toLowerCase();
  const existing = await prisma.careWaitlistEntry.findUnique({ where: { contact } });
  if (existing) {
    // Already on the list — same success surface, no dupes, no oracle
    // beyond what re-submitting your own contact would tell you anyway.
    return NextResponse.json({ ok: true });
  }

  await prisma.$transaction(async (tx) => {
    const row = await tx.careWaitlistEntry.create({ data: { contact } });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_WAITLIST_JOINED',
        targetType: 'CareWaitlistEntry',
        targetId: row.id,
        metadata: auditMetadataFromRequest(req),
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
