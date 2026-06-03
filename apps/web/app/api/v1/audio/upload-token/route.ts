import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_MIME = 'audio/pcm';
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const PATHNAME_RX = /^sessions\/([^/]+)\/(\d+)\.pcm$/;

/**
 * POST /api/v1/audio/upload-token — implements Vercel Blob's client-upload
 * handshake. The browser uses @vercel/blob/client.upload() which:
 *
 *   1. POSTs { type: 'blob.generate-client-token', payload } here.
 *      We validate ownership + session state and return a scoped, short-
 *      lived client token. (~500 ms)
 *   2. The browser uploads the audio body DIRECTLY to Vercel Blob's
 *      storage edge using that token — bypassing this function entirely.
 *      No Vercel function timeout risk (the upload doesn't run through us).
 *   3. After the upload completes, Vercel Blob POSTs
 *      { type: 'blob.upload-completed', payload } back here. We write
 *      the AudioChunk row + audit log. (~1 s)
 *
 * Replaces the legacy PUT /audio/[sessionId]/chunks/[chunkIndex] route
 * which streamed the audio body through a Vercel function — that path
 * was hitting the Hobby plan's 10 s function timeout on cold starts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const auth = await requirePsychologistId(request);
        if (!auth.ok) {
          throw new Error('Unauthorized — no valid psychologist for this request');
        }

        const match = PATHNAME_RX.exec(pathname);
        if (!match) {
          throw new Error(
            `Invalid pathname '${pathname}'. Expected sessions/<sessionId>/<chunkIndex>.pcm`,
          );
        }
        const sessionId = match[1]!;
        const chunkIndex = Number.parseInt(match[2]!, 10);

        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { psychologistId: true, status: true },
        });
        if (!session || session.psychologistId !== auth.value.psychologistId) {
          throw new Error(`Session ${sessionId} not found or not owned by current therapist`);
        }
        if (session.status !== 'IN_PROGRESS') {
          throw new Error(
            `Cannot upload chunks for a session in ${session.status} state — session must be IN_PROGRESS`,
          );
        }

        // Parse the client-supplied metadata (duration + sample rate). Validate
        // here so the onUploadCompleted webhook can trust it.
        let durationMs = 0;
        let sampleRate = 0;
        if (clientPayload) {
          try {
            const parsed = JSON.parse(clientPayload) as {
              durationMs?: number;
              sampleRate?: number;
            };
            durationMs = parsed.durationMs ?? 0;
            sampleRate = parsed.sampleRate ?? 0;
          } catch {
            throw new Error('clientPayload is not valid JSON');
          }
        }
        if (sampleRate !== 16000) {
          throw new Error('Sample rate must be 16000');
        }
        if (durationMs <= 0 || durationMs > 60_000) {
          throw new Error('durationMs must be > 0 and <= 60000');
        }

        return {
          allowedContentTypes: [VALID_MIME, `${VALID_MIME};rate=16000`],
          maximumSizeInBytes: MAX_CHUNK_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({
            sessionId,
            chunkIndex,
            psychologistId: auth.value.psychologistId,
            durationMs,
            sampleRate,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // No-op. The DB write happens via the client-driven
        // POST /audio/chunks/record path (see chunk-uploader.ts)
        // because Vercel Blob's server-to-server webhook is blocked by
        // the preview's Vercel Authentication SSO wall. The browser,
        // which has the SSO cookie, closes the loop instead. Logged
        // here in case the webhook DOES fire (production main domain
        // without SSO) so we can confirm and switch back to the
        // webhook path later.
        console.info(
          `[audio-upload-token] webhook fired url=${blob.url} tokenPayload=${tokenPayload ?? 'null'}`,
        );
      },
    });

    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error;
    console.warn(
      `[audio-upload-token] handshake rejected message=${err.message} stack=${err.stack?.split('\n')[1] ?? ''}`,
    );
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
