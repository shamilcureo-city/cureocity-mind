import { NextResponse, type NextRequest } from 'next/server';
import { CreateMoodLogInputSchema } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toMoodLog } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/mood-logs?limit=N — recent mood entries. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? '100'), 365);
  const rows = await prisma.moodLog.findMany({
    where: { clientId: auth.value.clientId },
    orderBy: { recordedAt: 'desc' },
    take: limit,
  });
  return NextResponse.json(rows.map(toMoodLog));
}

/** POST /api/v1/me/mood-logs — create + MOOD_LOGGED audit. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, CreateMoodLogInputSchema);
  if (!dto.ok) return dto.response;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.moodLog.create({
      data: {
        clientId: auth.value.clientId,
        rating: dto.value.rating,
        notes: dto.value.notes ?? null,
        recordedAt: dto.value.recordedAt ? new Date(dto.value.recordedAt) : new Date(),
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'MOOD_LOGGED',
        targetType: 'MoodLog',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: auth.value.clientId,
          rating: dto.value.rating,
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toMoodLog(created), { status: 201 });
}
