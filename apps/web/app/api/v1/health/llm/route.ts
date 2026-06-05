import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health/llm — diagnostic snapshot of the scribe pipeline
 * for the authenticated psychologist. Reveals:
 *   - Which backend the server will use on the next generate-note
 *     call (server-side LLM_BACKEND, NOT the misleading
 *     NEXT_PUBLIC_LLM_BACKEND build var)
 *   - Whether the required Vertex env vars are present (presence,
 *     not the values — never log secrets)
 *   - Optional ?sessionId=… returns audio-chunk count + last-draft
 *     error message for a specific session
 *
 * Designed to be the first thing a therapist hits when "transcription
 * is not working" — answers two questions in one call: "is the env
 * configured?" and "did the audio land?"
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');

  const llmBackend = process.env['LLM_BACKEND'] ?? 'mock';
  const vertexConfig = {
    LLM_BACKEND: llmBackend,
    VERTEX_PROJECT_ID_present: Boolean(process.env['VERTEX_PROJECT_ID']),
    VERTEX_PROJECT_ID_length: process.env['VERTEX_PROJECT_ID']?.length ?? 0,
    GOOGLE_APPLICATION_CREDENTIALS_present: Boolean(
      process.env['GOOGLE_APPLICATION_CREDENTIALS'],
    ),
    GOOGLE_APPLICATION_CREDENTIALS_JSON_present: Boolean(
      process.env['GOOGLE_APPLICATION_CREDENTIALS_JSON'],
    ),
    GOOGLE_APPLICATION_CREDENTIALS_JSON_length:
      process.env['GOOGLE_APPLICATION_CREDENTIALS_JSON']?.length ?? 0,
    VERTEX_FLASH_REGION: process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1 (default)',
    VERTEX_PRO_REGION: process.env['VERTEX_PRO_REGION'] ?? 'global (default)',
    VERTEX_FLASH_MODEL: process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash (default)',
    VERTEX_PRO_MODEL: process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro (default)',
  };

  // Quick verdict: what will go wrong on the next generate-note?
  const diagnostics: string[] = [];
  if (llmBackend !== 'vertex') {
    diagnostics.push(
      `LLM_BACKEND='${llmBackend}' — set to 'vertex' to enable real transcription.`,
    );
  }
  if (llmBackend === 'vertex' && !vertexConfig.VERTEX_PROJECT_ID_present) {
    diagnostics.push(
      'VERTEX_PROJECT_ID missing — orchestrator will throw at boot.',
    );
  }
  if (
    llmBackend === 'vertex' &&
    !vertexConfig.GOOGLE_APPLICATION_CREDENTIALS_present &&
    !vertexConfig.GOOGLE_APPLICATION_CREDENTIALS_JSON_present
  ) {
    diagnostics.push(
      'Neither GOOGLE_APPLICATION_CREDENTIALS nor GOOGLE_APPLICATION_CREDENTIALS_JSON is set — Vertex SDK will fail to authenticate.',
    );
  }

  let sessionDiag: Record<string, unknown> | null = null;
  if (sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, psychologistId: true, status: true, startedAt: true, endedAt: true },
    });
    if (!session || session.psychologistId !== auth.value.psychologistId) {
      sessionDiag = { error: 'Session not found' };
    } else {
      const [chunkCount, totalBytes, draft] = await Promise.all([
        prisma.audioChunk.count({ where: { sessionId } }),
        prisma.audioChunk
          .findMany({ where: { sessionId }, select: { bytes: true, durationMs: true } })
          .then((rows) => ({
            totalBytes: rows.reduce((acc, r) => acc + (r.bytes?.byteLength ?? 0), 0),
            totalDurationMs: rows.reduce((acc, r) => acc + (r.durationMs ?? 0), 0),
          })),
        prisma.noteDraft.findUnique({
          where: { sessionId },
          select: {
            status: true,
            errorMessage: true,
            transcript: true,
            totalCostInr: true,
            updatedAt: true,
          },
        }),
      ]);
      sessionDiag = {
        sessionStatus: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        audioChunkCount: chunkCount,
        audioTotalBytes: totalBytes.totalBytes,
        audioTotalDurationMs: totalBytes.totalDurationMs,
        noteDraft: draft
          ? {
              status: draft.status,
              errorMessage: draft.errorMessage,
              transcriptChars: draft.transcript?.length ?? 0,
              totalCostInr: draft.totalCostInr.toString(),
              updatedAt: draft.updatedAt,
            }
          : null,
      };
      if (chunkCount === 0) {
        diagnostics.push(
          `Session ${sessionId} has ZERO audio chunks — recording never reached the upload endpoint. Check browser console for /audio/chunks/upload failures during the session.`,
        );
      }
      if (chunkCount > 0 && totalBytes.totalBytes === 0) {
        diagnostics.push(
          `Session ${sessionId} has ${chunkCount} chunk rows but ZERO bytes — uploader posted but BYTEA didn't persist.`,
        );
      }
      if (draft?.status === 'FAILED') {
        diagnostics.push(
          `Last note generation FAILED: ${draft.errorMessage ?? '(no error message)'}`,
        );
      }
    }
  }

  return NextResponse.json({
    vertexConfig,
    diagnostics: diagnostics.length > 0 ? diagnostics : ['No issues detected.'],
    sessionDiag,
  });
}
