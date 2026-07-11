import { NextResponse, type NextRequest } from 'next/server';
import { CareCheckinInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** POST /api/v1/care/checkins (AC2) — the daily mood dial. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CareCheckinInputSchema);
  if (!input.ok) return input.response;

  const checkin = await prisma.$transaction(async (tx) => {
    const created = await tx.careCheckin.create({
      data: {
        careUserId: auth.value.careUserId,
        mood: input.value.mood,
        note: input.value.note ?? null,
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_CHECKIN_SUBMITTED',
        targetType: 'CareCheckin',
        targetId: created.id,
        metadata: { ...auditMetadataFromRequest(req), mood: input.value.mood },
      },
      tx,
    );
    return created;
  });

  return NextResponse.json({ id: checkin.id, mood: checkin.mood });
}
