import { NextResponse, type NextRequest } from 'next/server';
import {
  PreSessionBriefV1Schema,
  type PrepareHomeworkEntry,
  type PrepareSummaryV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { fetchOpenCrises } from '@/lib/crisis-flags';
import { computeClientJourney, JourneyError } from '@/lib/journey';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/clients/[id]/prepare — Sprint 50.
 *
 * Lazy summary for the Prepare panel on each Today screen session
 * card. Composed deterministically from cumulative state:
 *
 *   - Most recent COMPLETED PreSessionBrief, cached only (never
 *     triggers Pass 5 — N expanded cards must not bill N Gemini
 *     calls). The panel surfaces a "Generate fresh brief" button that
 *     hits the existing /pre-session-brief route when the therapist
 *     wants to spend.
 *   - `computeClientJourney` for stage + active plan + reliable-change
 *     verdicts + next-best action (shared with the Journey hub).
 *   - Latest 5 ExerciseAssignment rows so the homework chip reflects
 *     real status, not LLM guesswork.
 *   - Shared `fetchOpenCrises` so a high/critical crisis from a prior
 *     session surfaces the instant the card is expanded.
 *   - Last COMPLETED session id for the "Open last session's copilot"
 *     deep-link.
 *
 * Audits with `CLIENT_BRIEFING_VIEWED` + `metadata.surface =
 * 'today-prepare'` — no new audit action needed.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await ctx.params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, deletedAt: true, preferredLanguage: true },
  });
  if (!client || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  let journey;
  try {
    journey = await computeClientJourney(clientId, auth.value.psychologistId);
  } catch (e) {
    if (e instanceof JourneyError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }

  // Find the latest COMPLETED session — its id drives both the
  // "Open last session's copilot" link and the brief-staleness check.
  const lastCompleted = await prisma.session.findFirst({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { endedAt: 'desc' },
    select: { id: true },
  });

  // Cached-only brief lookup. We pick the most recent COMPLETED brief
  // in the client's preferred language; the route does NOT trigger a
  // fresh Pass-5 generation. The therapist can do that explicitly from
  // the panel.
  const cachedBriefRow = await prisma.preSessionBrief.findFirst({
    where: {
      clientId,
      status: 'COMPLETED',
      language: client.preferredLanguage,
    },
    orderBy: { createdAt: 'desc' },
    select: { body: true, lastSessionId: true },
  });
  const briefParsed = cachedBriefRow?.body
    ? PreSessionBriefV1Schema.safeParse(cachedBriefRow.body)
    : null;
  const cachedBrief = briefParsed?.success ? briefParsed.data : null;
  const briefIsStale =
    cachedBrief !== null && cachedBriefRow?.lastSessionId !== (lastCompleted?.id ?? null);

  const [assignments, openCrises] = await Promise.all([
    prisma.exerciseAssignment.findMany({
      where: { clientId },
      orderBy: { assignedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        assignedAt: true,
        completedAt: true,
        dueAt: true,
        exerciseId: true,
        customDescription: true,
        therapistNote: true,
      },
    }),
    fetchOpenCrises(clientId),
  ]);

  const homework: PrepareHomeworkEntry[] = assignments.map((a) => ({
    id: a.id,
    // Sprint 51 — script-sourced rows have customDescription;
    // catalog rows fall back to the therapist's note or the catalog
    // id stem so the panel always renders something readable.
    description:
      a.customDescription?.trim() ||
      a.therapistNote?.trim() ||
      a.exerciseId ||
      'Homework',
    status: a.status,
    assignedAt: a.assignedAt.toISOString(),
    completedAt: a.completedAt?.toISOString() ?? null,
    dueAt: a.dueAt?.toISOString() ?? null,
  }));

  const summary: PrepareSummaryV1 = {
    version: 'V1',
    clientId,
    cachedBrief,
    briefIsStale,
    journey: {
      stage: journey.stage,
      activePlan: journey.activePlan,
      instrumentChanges: journey.instrumentChanges,
      nextBestAction: journey.nextBestAction,
    },
    homework,
    openCrises,
    lastCompletedSessionId: lastCompleted?.id ?? null,
  };

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLIENT_BRIEFING_VIEWED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      surface: 'today-prepare',
      hasCachedBrief: cachedBrief !== null,
      briefIsStale,
      openCrisisCount: openCrises.length,
      homeworkCount: homework.length,
    },
  });

  return NextResponse.json(summary);
}
