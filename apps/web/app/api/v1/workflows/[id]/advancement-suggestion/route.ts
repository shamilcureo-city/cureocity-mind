import { NextResponse, type NextRequest } from 'next/server';
import type {
  AdvancementSuggestion,
  TherapyNoteV1,
  WorkflowGoal,
} from '@cureocity/contracts';
import { evaluateCbtAdvancement } from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/workflows/[id]/advancement-suggestion — invokes the
 * clinical package's evaluateCbtAdvancement (CBT only in V1 — EMDR
 * advancement is gated by the Phase-2 preparation flag, handled
 * separately in Sprint 4).
 *
 * Reads up to 10 most-recent COMPLETED sessions for the client + their
 * signed TherapyNotes, plus the count of sessions while the workflow
 * has been in its current phase.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const state = await prisma.modalityState.findUnique({
    where: { id },
    include: { transitions: { orderBy: { occurredAt: 'desc' }, take: 1 } },
  });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  if (state.modality !== 'CBT') {
    return NextResponse.json(
      {
        error:
          'EMDR advancement-suggestion not yet implemented — Phase 2 preparation gate ships in Sprint 4',
      },
      { status: 501 },
    );
  }

  // "Sessions in the current phase" = sessions that ended after the most
  // recent transition (or since workflow start if no transitions yet).
  const phaseStartedAt =
    state.transitions[0]?.occurredAt ?? state.startedAt;
  const sessionsInCurrentPhase = await prisma.session.count({
    where: {
      clientId: state.clientId,
      status: 'COMPLETED',
      endedAt: { gte: phaseStartedAt },
    },
  });

  // Most recent 10 COMPLETED sessions, newest first, with their signed
  // TherapyNote content (if any).
  const sessions = await prisma.session.findMany({
    where: {
      clientId: state.clientId,
      status: 'COMPLETED',
      endedAt: { not: null },
    },
    orderBy: { endedAt: 'desc' },
    take: 10,
    include: { therapyNote: true },
  });

  const recentNotes = sessions.map((s) => ({
    content: (s.therapyNote?.content as unknown as TherapyNoteV1 | null) ?? null,
    endedAt: s.endedAt!,
  }));

  const goals = (state.goals as WorkflowGoal[]) ?? [];

  const decision = evaluateCbtAdvancement({
    currentPhase: state.currentPhase,
    recentNotes,
    goals,
    sessionsInCurrentPhase,
  });

  const response: AdvancementSuggestion = {
    workflowId: state.id,
    currentPhase: state.currentPhase,
    suggestedPhase: decision.suggestedPhase,
    confidence: decision.confidence,
    rationale: decision.rationale,
    signals: decision.signals as unknown as Record<string, unknown>,
  };
  return NextResponse.json(response);
}
