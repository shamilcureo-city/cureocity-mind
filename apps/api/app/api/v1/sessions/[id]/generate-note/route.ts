import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth';
import { runNoteGeneration } from '@/lib/note-orchestrator';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Pro: 60s. The cost guard caps spend such that Pass 1 + Pass 2
// typically stay under 30s on Gemini Flash + Pro.
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/sessions/:id/generate-note — synchronous two-pass
 * Gemini, replacing the BullMQ worker the NestJS scribe-service ran.
 *
 * The PWA flow becomes:
 *   1. POST /sessions/:id/end          (transitions to COMPLETED + creates PENDING draft)
 *   2. POST /sessions/:id/generate-note (this — runs Pass 1+Pass 2 inline)
 *   3. GET  /sessions/:id/note-draft   (poll until COMPLETED)
 *
 * Idempotent: a COMPLETED draft returns 200 with the existing
 * draftId; a FAILED or IN_PROGRESS draft re-runs the orchestrator.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true, status: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: `Cannot generate a note for a session in ${session.status} state` },
      { status: 400 },
    );
  }

  const result = await runNoteGeneration(sessionId);
  const httpStatus = result.status === 'COMPLETED' ? 200 : 500;
  return NextResponse.json(result, { status: httpStatus });
}
