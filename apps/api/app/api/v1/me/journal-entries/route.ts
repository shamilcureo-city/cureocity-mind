import { NextResponse, type NextRequest } from 'next/server';
import { CreateJournalEntryInputSchema } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toJournalEntry } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/journal-entries?limit=N — recent entries. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? '50'), 200);
  const rows = await prisma.journalEntry.findMany({
    where: { clientId: auth.value.clientId },
    orderBy: { recordedAt: 'desc' },
    take: limit,
  });
  return NextResponse.json(rows.map(toJournalEntry));
}

/**
 * POST /api/v1/me/journal-entries — create. NB: this BFF doesn't
 * currently encrypt contentEncrypted (Sprint 9 PR 3 wired that into
 * the NestJS continuity-service via @cureocity/crypto). When the
 * Vercel deploy needs it, port apps/api/lib/encryption.ts following
 * the same KMS pattern and call it here.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, CreateJournalEntryInputSchema);
  if (!dto.ok) return dto.response;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.journalEntry.create({
      data: {
        clientId: auth.value.clientId,
        content: dto.value.content,
        mood: dto.value.mood ?? null,
        sharedWithTherapist: dto.value.sharedWithTherapist ?? false,
        recordedAt: dto.value.recordedAt ? new Date(dto.value.recordedAt) : new Date(),
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'JOURNAL_ENTRY_CREATED',
        targetType: 'JournalEntry',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: auth.value.clientId,
          contentLength: dto.value.content.length,
          hasMood: dto.value.mood !== undefined,
          sharedWithTherapist: dto.value.sharedWithTherapist ?? false,
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toJournalEntry(created), { status: 201 });
}
