import { NextResponse, type NextRequest } from 'next/server';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETENTION_DAYS = Number(process.env['AUDIO_RETENTION_DAYS'] ?? 30);

/**
 * Batch E (DPDP) — how long a VERBATIM TRANSCRIPT is kept, in days.
 *
 * The audio purge could never reach a live consult: the live path streams
 * PCM straight to the gateway and never writes an AudioChunk, so its raw
 * capture only ever exists as `NoteDraft.transcript`. Batch audio aged out at
 * 30 days while live transcripts — the same personal data in text form — were
 * kept forever.
 *
 * DELIBERATELY OFF BY DEFAULT. A transcript is the evidence behind a signed
 * clinical note (the linked-evidence quotes resolve against it), so deleting
 * it is an operator's decision with a legal and clinical dimension, not
 * something a code change should switch on silently. Set
 * TRANSCRIPT_RETENTION_DAYS to enable; the structured note is never touched.
 */
const TRANSCRIPT_RETENTION_DAYS = process.env['TRANSCRIPT_RETENTION_DAYS']
  ? Number(process.env['TRANSCRIPT_RETENTION_DAYS'])
  : null;

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
  let segmentsDeleted = 0;
  for (const s of sessions) {
    if (extendedClientIds.has(s.clientId)) continue;
    const chunkIds = s.audioChunks.map((c) => c.id).filter(Boolean);
    if (chunkIds.length === 0) continue;
    const bytes = s.audioChunks.reduce((a, c) => a + c.sizeBytes, 0);

    await prisma.$transaction(async (tx) => {
      await tx.audioChunk.deleteMany({ where: { id: { in: chunkIds } } });
      // S-hardening (2026-08) — the per-window TranscriptSegment rows are the
      // same raw capture as the audio, in plaintext text form, and were never
      // purged: they accumulated forever. They exist only to assemble the
      // final transcript (which NoteDraft holds, encrypted), so they age out
      // on exactly the audio's clock and consent rules.
      const segs = await tx.transcriptSegment.deleteMany({ where: { sessionId: s.id } });
      segmentsDeleted += segs.count;
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'AUDIO_RETENTION_PURGED',
          targetType: 'Session',
          targetId: s.id,
          metadata: {
            clientId: s.clientId,
            chunksDeleted: chunkIds.length,
            segmentsDeleted: segs.count,
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

  const transcripts = await purgeTranscripts(extendedClientIds);

  const totalBytes = purgedSessions.reduce((a, p) => a + p.bytes, 0);
  const totalChunks = purgedSessions.reduce((a, p) => a + p.chunks, 0);

  return NextResponse.json({
    transcriptRetentionDays: TRANSCRIPT_RETENTION_DAYS,
    transcriptsPurged: transcripts,
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
    extendedRetentionClients: extendedClientIds.size,
    sessionsConsidered: sessions.length,
    sessionsPurged: purgedSessions.length,
    chunksDeleted: totalChunks,
    segmentsDeleted,
    bytesDeleted: totalBytes,
  });
}

/**
 * Batch E — purge verbatim transcripts past TRANSCRIPT_RETENTION_DAYS. Clears
 * both the plaintext and the encrypted copy and leaves a marker in their
 * place, so the NoteDraft's presence check still holds and the UI can say
 * "purged" rather than rendering a confusing blank. The structured note, the
 * signature and the Rx are untouched — only the raw capture goes.
 *
 * Returns the number of drafts purged; 0 when the feature is off.
 */
async function purgeTranscripts(extendedClientIds: Set<string>): Promise<number> {
  if (TRANSCRIPT_RETENTION_DAYS === null || !Number.isFinite(TRANSCRIPT_RETENTION_DAYS)) return 0;
  const cutoff = new Date(Date.now() - TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const drafts = await prisma.noteDraft.findMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [{ transcript: { not: PURGED_MARKER } }, { transcriptEncrypted: { not: null } }],
    },
    select: {
      id: true,
      transcript: true,
      session: { select: { id: true, clientId: true } },
    },
    take: 500,
  });

  let purged = 0;
  for (const d of drafts) {
    if (extendedClientIds.has(d.session.clientId)) continue;
    const chars = d.transcript?.length ?? 0;
    await prisma.$transaction(async (tx) => {
      await tx.noteDraft.update({
        where: { id: d.id },
        data: { transcript: PURGED_MARKER, transcriptEncrypted: null },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'TRANSCRIPT_RETENTION_PURGED',
          targetType: 'NoteDraft',
          targetId: d.id,
          metadata: {
            sessionId: d.session.id,
            clientId: d.session.clientId,
            chars,
            retentionDays: TRANSCRIPT_RETENTION_DAYS,
          },
        },
        tx,
      );
    });
    purged += 1;
  }
  return purged;
}

/** What a purged transcript reads as. Not empty — a blank would look broken. */
const PURGED_MARKER = '(transcript purged per data-retention policy)';

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
