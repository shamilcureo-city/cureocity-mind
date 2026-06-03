import { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_MIME = 'audio/pcm';
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

interface RecordChunkBody {
  sessionId?: string;
  chunkIndex?: number;
  blobUrl?: string;
  durationMs?: number;
  sampleRate?: number;
  sizeBytes?: number;
}

/**
 * POST /api/v1/audio/chunks/record — called by the browser AFTER
 * @vercel/blob/client.upload() resolves with a blob URL. We can't rely
 * on Vercel Blob's onUploadCompleted webhook in this deployment because
 * the preview URL is behind Vercel Authentication SSO — server-to-server
 * webhooks from Vercel Blob arrive without the SSO cookie and get
 * bounced at the auth wall before reaching the function. The browser,
 * which already has the SSO session, completes the loop instead.
 *
 * Security: the request is authenticated, the sessionId must be owned
 * by the caller and IN_PROGRESS, and the pathname encoded in the blob
 * URL is matched against the claimed (sessionId, chunkIndex). The
 * UNIQUE (sessionId, chunkIndex) constraint makes retries idempotent.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(request);
  if (!auth.ok) return auth.response;

  let body: RecordChunkBody;
  try {
    body = (await request.json()) as RecordChunkBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, chunkIndex, blobUrl, durationMs, sampleRate, sizeBytes } = body;
  if (
    typeof sessionId !== 'string' ||
    typeof chunkIndex !== 'number' ||
    typeof blobUrl !== 'string' ||
    typeof durationMs !== 'number' ||
    typeof sampleRate !== 'number' ||
    typeof sizeBytes !== 'number'
  ) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (sampleRate !== 16000) {
    return NextResponse.json({ error: 'Sample rate must be 16000' }, { status: 400 });
  }
  if (durationMs <= 0 || durationMs > 60_000) {
    return NextResponse.json({ error: 'durationMs out of range' }, { status: 400 });
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: 'sizeBytes out of range' }, { status: 400 });
  }

  // The blob URL must encode the same pathname we approved at token-mint
  // time. We validate the structural shape; the actual upload was gated
  // server-side via the upload-token handshake, so a forged URL with the
  // right shape is still bounded to a path this user was authorised for.
  const pathSuffix = `/sessions/${sessionId}/${chunkIndex}.pcm`;
  if (!blobUrl.endsWith(pathSuffix)) {
    return NextResponse.json(
      { error: `blobUrl '${blobUrl}' does not end with expected '${pathSuffix}'` },
      { status: 400 },
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true, status: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { error: `Session is in ${session.status} state, not IN_PROGRESS` },
      { status: 409 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.audioChunk.create({
        data: {
          sessionId,
          chunkIndex,
          mimeType: VALID_MIME,
          sampleRate,
          sizeBytes,
          durationMs,
          s3Key: blobUrl,
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
            blobUrl,
            sizeBytes,
            uploadedViaClientDirect: true,
          },
        },
        tx,
      );
    });
    console.info(
      `[audio-chunks-record] ok sessionId=${sessionId} chunkIndex=${chunkIndex} url=${blobUrl}`,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      console.info(
        `[audio-chunks-record] duplicate (idempotent) sessionId=${sessionId} chunkIndex=${chunkIndex}`,
      );
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    const err = e as { name?: string; message?: string };
    console.error(
      `[audio-chunks-record] db-write failure name=${err.name ?? 'unknown'} message=${err.message ?? String(e)} sessionId=${sessionId} chunkIndex=${chunkIndex}`,
    );
    return NextResponse.json({ error: 'Server error recording chunk' }, { status: 500 });
  }
}
