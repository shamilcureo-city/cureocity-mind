import { NextResponse, type NextRequest } from 'next/server';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETENTION_DAYS = Number(process.env['AUDIO_RETENTION_DAYS'] ?? 30);

/**
 * GET /api/v1/cron/audio-retention — daily audio purge per DPDP
 * 30-day retention. Deletes AudioChunk rows whose session ended
 * more than RETENTION_DAYS ago, UNLESS the session's client has a
 * GRANTED Consent of scope DATA_RETENTION_EXTENDED in effect.
 *
 * AUD3 — the purge also covers sessions that never COMPLETED
 * (abandoned recordings: browser closed mid-session, cancelled,
 * no-show with uploaded audio). Anchored on createdAt since those
 * rows have no endedAt — audio must not outlive the retention
 * window just because the session was never finished.
 *
 * Auth: requires X-Vercel-Cron header (auto-set by Vercel when
 * invoked via vercel.json cron schedule) OR CRON_SECRET env var
 * matching the Authorization Bearer header for manual / external
 * invocations.
 *
 * Audits one AUDIO_RETENTION_PURGED row per session purged so the
 * regulator can prove the purge happened on schedule. SYSTEM
 * actor since no human triggered it.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const extendedClientIds = new Set(
    (
      await prisma.consent.findMany({
        where: { scope: 'DATA_RETENTION_EXTENDED', status: 'GRANTED', withdrawnAt: null },
        select: { clientId: true },
      })
    ).map((c) => c.clientId),
  );

  // Find sessions whose audio is eligible for purge: past the cutoff
  // (ended before it, or never completed and created before it), holding
  // at least one chunk, and whose client is not on the extended-retention
  // allowlist.
  const sessions = await prisma.session.findMany({
    where: {
      OR: [
        { status: 'COMPLETED', endedAt: { not: null, lt: cutoff } },
        // AUD3 — abandoned / never-completed sessions age out on createdAt.
        { status: { not: 'COMPLETED' }, createdAt: { lt: cutoff } },
      ],
      audioChunks: { some: {} },
    },
    select: {
      id: true,
      clientId: true,
      status: true,
      endedAt: true,
      createdAt: true,
      audioChunks: { select: { id: true, sizeBytes: true } },
    },
  });

  const purgedSessions: Array<{
    sessionId: string;
    clientId: string;
    bytes: number;
    chunks: number;
  }> = [];
  for (const s of sessions) {
    if (extendedClientIds.has(s.clientId)) continue;
    const chunkIds = s.audioChunks.map((c) => c.id).filter(Boolean);
    if (chunkIds.length === 0) continue;
    const bytes = s.audioChunks.reduce((a, c) => a + c.sizeBytes, 0);

    await prisma.$transaction(async (tx) => {
      await tx.audioChunk.deleteMany({ where: { id: { in: chunkIds } } });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'AUDIO_RETENTION_PURGED',
          targetType: 'Session',
          targetId: s.id,
          metadata: {
            clientId: s.clientId,
            chunksDeleted: chunkIds.length,
            bytesDeleted: bytes,
            sessionStatus: s.status,
            sessionEndedAt: s.endedAt?.toISOString() ?? null,
            sessionCreatedAt: s.createdAt.toISOString(),
            retentionDays: RETENTION_DAYS,
          },
        },
        tx,
      );
    });
    purgedSessions.push({ sessionId: s.id, clientId: s.clientId, bytes, chunks: chunkIds.length });
  }

  const totalBytes = purgedSessions.reduce((a, p) => a + p.bytes, 0);
  const totalChunks = purgedSessions.reduce((a, p) => a + p.chunks, 0);

  return NextResponse.json({
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
    extendedRetentionClients: extendedClientIds.size,
    sessionsConsidered: sessions.length,
    sessionsPurged: purgedSessions.length,
    chunksDeleted: totalChunks,
    bytesDeleted: totalBytes,
  });
}

function isAuthorized(req: NextRequest): boolean {
  // AUD1 — fail closed: CRON_SECRET must be set, and every invocation must
  // carry it. Vercel automatically sends `Authorization: Bearer $CRON_SECRET`
  // on scheduled invocations when the env var exists, so the x-vercel-cron
  // header alone is no longer sufficient (defense in depth if the app is
  // ever fronted differently).
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — refusing all cron invocations (fail closed).');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
