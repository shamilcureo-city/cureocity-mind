import { Prisma } from '@prisma/client';
import { NextResponse, after, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { transcribeChunkInline } from '@/lib/transcribe-segment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_MIME = 'audio/pcm';
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/v1/audio/chunks/upload — direct chunk upload into Postgres
 * BYTEA. Replaces the @vercel/blob/client.upload() path which was
 * observed to hang silently in production for unknown reasons (handshake
 * 200 but the storage PUT never returned). This route trades external
 * object storage for a function-bound INSERT but stays well under the
 * Hobby 10 s function timeout for a ~960 KB PCM chunk:
 *   cold-start ~2 s + auth ~100 ms + session lookup ~300 ms +
 *   1 MB BYTEA INSERT ~300 ms ≈ 3 s worst case.
 *
 * Body:    raw PCM bytes (Content-Type: audio/pcm)
 * Headers: X-Session-Id, X-Chunk-Index, X-Duration-Ms, X-Sample-Rate
 *
 * Idempotent on (sessionId, chunkIndex) — duplicate uploads return 200.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(request);
  if (!auth.ok) return auth.response;

  const sessionId = request.headers.get('x-session-id');
  const chunkIndexStr = request.headers.get('x-chunk-index');
  const durationMsStr = request.headers.get('x-duration-ms');
  const sampleRateStr = request.headers.get('x-sample-rate');
  if (!sessionId || !chunkIndexStr || !durationMsStr || !sampleRateStr) {
    return NextResponse.json(
      { error: 'Missing one of X-Session-Id, X-Chunk-Index, X-Duration-Ms, X-Sample-Rate' },
      { status: 400 },
    );
  }
  const chunkIndex = Number.parseInt(chunkIndexStr, 10);
  const durationMs = Number.parseInt(durationMsStr, 10);
  const sampleRate = Number.parseInt(sampleRateStr, 10);
  if (!Number.isFinite(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json(
      { error: 'X-Chunk-Index must be a non-negative integer' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 60_000) {
    return NextResponse.json({ error: 'X-Duration-Ms out of range' }, { status: 400 });
  }
  if (sampleRate !== 16000) {
    return NextResponse.json({ error: 'X-Sample-Rate must be 16000' }, { status: 400 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith(VALID_MIME)) {
    return NextResponse.json(
      { error: `Content-Type must be ${VALID_MIME}, got '${contentType}'` },
      { status: 400 },
    );
  }

  const arrayBuffer = await request.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.byteLength <= 0) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_CHUNK_BYTES) {
    return NextResponse.json(
      { error: `Body ${bytes.byteLength} bytes exceeds ${MAX_CHUNK_BYTES} cap` },
      { status: 413 },
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      psychologistId: true,
      status: true,
      noteDraft: { select: { status: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  // REL-1 — accept late tail chunks after "End session". The recorder flushes
  // its last window(s) asynchronously, so a chunk can land just after the
  // session flips IN_PROGRESS → COMPLETED. Rejecting it (the old
  // status !== 'IN_PROGRESS' gate) silently dropped that audio from the note.
  // A COMPLETED session still accepts chunks UNTIL its note is finalized
  // (NoteDraft COMPLETED) — after that the note is done and more audio is
  // pointless. Any other state (CANCELLED / NO_SHOW / …) rejects outright.
  const noteFinalized = session.noteDraft?.status === 'COMPLETED';
  const acceptsChunks =
    session.status === 'IN_PROGRESS' || (session.status === 'COMPLETED' && !noteFinalized);
  if (!acceptsChunks) {
    const reason = noteFinalized
      ? 'note already finalized'
      : `session is in ${session.status} state`;
    return NextResponse.json({ error: `Cannot accept audio: ${reason}` }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.audioChunk.create({
        data: {
          sessionId,
          chunkIndex,
          mimeType: VALID_MIME,
          sampleRate,
          sizeBytes: bytes.byteLength,
          durationMs,
          bytes,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'AUDIO_CHUNK_UPLOADED',
          targetType: 'AudioChunk',
          targetId: row.id,
          metadata: {
            ...auditMetadataFromRequest(request),
            sessionId,
            chunkIndex,
            sizeBytes: bytes.byteLength,
            storage: 'postgres-bytea',
          },
        },
        tx,
      );
    });
    console.info(
      `[audio-chunks-upload] ok sessionId=${sessionId} chunkIndex=${chunkIndex} size=${bytes.byteLength}`,
    );
    // Sprint 57 — transcribe-on-arrival. Fire-and-forget Pass 1 on this one
    // window via Next.js `after()` so the recorder's next request isn't
    // blocked. The orchestrator backstop at "End session" re-tries any
    // chunk this misses (network blip, Vertex 5xx, function reaped).
    after(async () => {
      try {
        const result = await transcribeChunkInline({ sessionId, chunkIndex });
        console.info(
          `[audio-chunks-upload] transcribe sessionId=${sessionId} chunkIndex=${chunkIndex} ${result.status}`,
        );
      } catch (e) {
        console.error(
          `[audio-chunks-upload] transcribe threw sessionId=${sessionId} chunkIndex=${chunkIndex}: ${(e as Error).message}`,
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      console.info(
        `[audio-chunks-upload] duplicate (idempotent) sessionId=${sessionId} chunkIndex=${chunkIndex}`,
      );
      // Re-trigger transcription for the duplicate too — the original
      // attempt may have completed the AudioChunk insert but had its
      // after() callback killed before transcription ran.
      after(async () => {
        try {
          await transcribeChunkInline({ sessionId, chunkIndex });
        } catch {
          /* swallow — the orchestrator backstop will retry */
        }
      });
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    const err = e as { name?: string; message?: string };
    console.error(
      `[audio-chunks-upload] db-write failure name=${err.name ?? 'unknown'} message=${err.message ?? String(e)} sessionId=${sessionId} chunkIndex=${chunkIndex}`,
    );
    return NextResponse.json({ error: 'Server error recording chunk' }, { status: 500 });
  }
}
