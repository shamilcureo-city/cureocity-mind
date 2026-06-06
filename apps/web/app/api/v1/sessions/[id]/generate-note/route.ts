import { NextResponse, after, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { runClinicalAnalysis, runNoteGeneration } from '@/lib/note-orchestrator';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Pro plan caps at 300s. Pass 1 + Pass 2 typically finish well
// inside 60s; Pass 3 is dispatched via after() so it doesn't block the
// HTTP response — bumping the cap is a margin of safety against rare
// slow Gemini calls (Sprint 19 hotfix after first prod 504).
export const maxDuration = 300;

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
  // Schedule Pass 3 (Clinical Analysis) to run AFTER the response is
  // sent. Vercel keeps the function alive for the after() callback up
  // to maxDuration; a Pass 3 failure is non-fatal (the Clinical Brief
  // / Initial Assessment tab surfaces it and offers manual retry).
  // pendingClinicalAnalysisArgs is only present on Pass 2 success.
  if (result.pendingClinicalAnalysisArgs) {
    const pass3Args = result.pendingClinicalAnalysisArgs;
    after(async () => {
      try {
        await runClinicalAnalysis(pass3Args);
      } catch (e) {
        console.error(
          `[generate-note:after] Pass 3 failed for session ${sessionId}: ${(e as Error).message}`,
        );
      }
    });
  }
  const httpStatus = result.status === 'COMPLETED' ? 200 : 500;
  return NextResponse.json(
    // Drop the args from the client-facing payload — they include the
    // full transcript and shouldn't ride the response wire.
    { draftId: result.draftId, status: result.status, errorMessage: result.errorMessage },
    { status: httpStatus },
  );
}
