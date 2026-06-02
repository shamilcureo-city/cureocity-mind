import { put } from '@vercel/blob';
import { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB hard cap
const VALID_MIME = 'audio/pcm';

interface RouteContext {
  params: Promise<{ sessionId: string; chunkIndex: string }>;
}

/**
 * PUT /api/v1/audio/:sessionId/chunks/:chunkIndex — single chunk
 * upload, ported from scribe-service AudioService.uploadChunk.
 *
 * Vercel-specific: instead of S3 PutObject, we go through @vercel/blob
 * which the Vercel platform provisions automatically when the project
 * is linked. The key path mirrors the original
 * `sessions/<id>/<chunkIndex>.pcm`.
 *
 * Body size cap is 2 MB — Vercel Function bodies max out at 4.5 MB,
 * but the recorder produces 16 kHz / 1 s frames = ~32 KB so we have
 * headroom + a fail-fast on misconfigured clients.
 *
 * Idempotency: (sessionId, chunkIndex) is uniquely indexed; a
 * duplicate PUT returns 200 (not 409) so the patient PWA's
 * exponential-backoff retry loop is a no-op on success.
 */
export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { sessionId, chunkIndex: chunkIndexStr } = await ctx.params;
  const chunkIndex = Number.parseInt(chunkIndexStr, 10);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json(
      { error: 'chunkIndex must be a non-negative integer' },
      { status: 400 },
    );
  }

  if (req.headers.get('content-type')?.split(';')[0]?.trim() !== VALID_MIME) {
    return NextResponse.json({ error: `Content-Type must be ${VALID_MIME}` }, { status: 415 });
  }
  const sampleRate = Number.parseInt(req.headers.get('x-sample-rate') ?? '0', 10);
  const durationMs = Number.parseInt(req.headers.get('x-duration-ms') ?? '0', 10);
  if (sampleRate !== 16000) {
    return NextResponse.json({ error: 'Sample rate must be 16000' }, { status: 400 });
  }
  if (durationMs <= 0 || durationMs > 60_000) {
    return NextResponse.json({ error: 'X-Duration-Ms must be > 0 and ≤ 60000' }, { status: 400 });
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
      { error: `Cannot upload chunks for a session in ${session.status} state` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }
  if (buffer.length > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: `Chunk exceeds ${MAX_CHUNK_BYTES} bytes` }, { status: 413 });
  }

  // Upload to Vercel Blob; on idempotent retry the blob URL collides
  // harmlessly because Blob supports `addRandomSuffix: false`.
  const blobKey = `sessions/${sessionId}/${chunkIndex}.pcm`;
  const blob = await put(blobKey, buffer, {
    access: 'public',
    contentType: VALID_MIME,
    addRandomSuffix: false,
  });

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.audioChunk.create({
        data: {
          sessionId,
          chunkIndex,
          mimeType: VALID_MIME,
          sampleRate,
          sizeBytes: buffer.length,
          durationMs,
          s3Key: blob.url,
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
            ...auditMetadataFromRequest(req),
            sessionId,
            chunkIndex,
            sizeBytes: buffer.length,
          },
        },
        tx,
      );
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // (sessionId, chunkIndex) collision — idempotent re-upload.
      return new NextResponse(null, { status: 200 });
    }
    throw e;
  }
  return new NextResponse(null, { status: 201 });
}
