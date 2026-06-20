import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  type ClinicalLocale,
  ClinicalLocaleSchema,
  type ClinicalTreatmentPlan,
  GeneratePreSessionBriefQuerySchema,
} from '@cureocity/contracts';
import { recordCostInr, recordGeminiCall } from '@cureocity/observability/metrics';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toPreSessionBrief } from '@/lib/clinical-mappers';
import { fetchOpenCrises } from '@/lib/crisis-flags';
import { modelRouter } from '@/lib/llm';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/clients/[id]/pre-session-brief?language=X&refresh=1
 *
 * Returns a Pass 5 PreSessionBriefV1, cached per
 * (clientId, lastSessionId, language). The cache is invalidated by
 * a new completed session because we key on lastSessionId; refresh=1
 * forces a fresh generation otherwise.
 *
 * Best-effort: a Pass 5 failure surfaces as a FAILED row and a 502;
 * the UI offers a retry button.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const query = parseQuery(req.url, GeneratePreSessionBriefQuerySchema);
  if (!query.ok) return query.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      psychologistId: true,
      preferredLanguage: true,
      presentingConcerns: true,
      deletedAt: true,
    },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const language: ClinicalLocale =
    query.value.language ??
    (ClinicalLocaleSchema.safeParse(client.preferredLanguage).success
      ? (client.preferredLanguage as ClinicalLocale)
      : 'en');

  // Identify the most recent COMPLETED session for cache-key purposes.
  const lastSession = await prisma.session.findFirst({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { endedAt: 'desc' },
    select: {
      id: true,
      noteDraft: { select: { content: true } },
      therapyNote: { select: { content: true } },
    },
  });
  const lastSessionId = lastSession?.id ?? null;

  // Cache hit fast path — unless refresh=true.
  if (!query.value.refresh) {
    const cached = await prisma.preSessionBrief.findFirst({
      where: {
        clientId,
        psychologistId: auth.value.psychologistId,
        lastSessionId,
        language,
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (cached) {
      await writeAudit({
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'PRE_SESSION_BRIEF_VIEWED',
        targetType: 'PreSessionBrief',
        targetId: cached.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          lastSessionId,
          language,
          source: 'cache',
        },
      });
      return NextResponse.json({ brief: toPreSessionBrief(cached), source: 'cache' });
    }
  }

  // Pull grounding context.
  const [primaryDx, activePlan, sessionsSoFar, openCrises, latestInstruments] = await Promise.all([
    prisma.clientDiagnosis.findFirst({
      where: { clientId, isPrimary: true, supersededAt: null },
      orderBy: { confirmedAt: 'desc' },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
    }),
    prisma.session.count({ where: { clientId, status: 'COMPLETED' } }),
    fetchOpenCrises(clientId),
    prisma.instrumentResponse.findMany({
      where: { clientId },
      orderBy: { administeredAt: 'desc' },
      take: 6,
    }),
  ]);

  const planBody = activePlan ? (activePlan.body as unknown as ClinicalTreatmentPlan) : null;
  const planSummary = planBody
    ? {
        modality: planBody.modality,
        phaseSequence: planBody.phaseSequence,
        goals: planBody.goals,
        expectedDurationSessions: planBody.expectedDurationSessions,
        sessionsSoFar,
      }
    : undefined;

  const lastSessionSummary = extractLastSummary(lastSession);

  // Insert PENDING row first so the UI can poll if needed.
  const briefRow = await prisma.preSessionBrief.create({
    data: {
      clientId,
      psychologistId: auth.value.psychologistId,
      lastSessionId,
      language,
      status: 'PENDING',
    },
  });

  try {
    const router = modelRouter();
    const pass5 = await router.pass5({
      clientId,
      language,
      sessionNumber: sessionsSoFar + 1,
      ...(primaryDx && {
        primaryDiagnosis: {
          icd11Code: primaryDx.icd11Code,
          icd11Label: primaryDx.icd11Label,
        },
      }),
      ...(planSummary && { treatmentPlan: planSummary }),
      ...(lastSessionSummary !== null && { lastSessionSummary }),
      ...(client.presentingConcerns !== null && {
        presentingConcerns: client.presentingConcerns,
      }),
      openCrises: openCrises.map((c) => ({
        kind: c.kind,
        severity: c.severity,
        lastSeenAt: c.lastSeenAt,
      })),
      latestInstruments: latestInstruments.map((i) => ({
        instrumentKey: i.instrumentKey,
        score: i.score,
        severity: i.severity,
        administeredAt: i.administeredAt.toISOString(),
      })),
    });

    recordGeminiCall({
      pass: pass5.callLog.pass,
      status: pass5.callLog.status,
      region: pass5.callLog.region,
      durationMs: pass5.callLog.latencyMs,
    });
    recordCostInr({
      service: 'gemini-pass-5',
      durationLabel: 'pre_session_brief',
      inr: pass5.callLog.costInr,
    });
    await prisma.geminiCallLog.create({
      data: {
        sessionId: null,
        pass: pass5.callLog.pass,
        model: pass5.callLog.model,
        region: pass5.callLog.region,
        promptVersion: pass5.callLog.promptVersion,
        inputTokens: pass5.callLog.inputTokens,
        outputTokens: pass5.callLog.outputTokens,
        costInr: new Prisma.Decimal(pass5.callLog.costInr),
        latencyMs: pass5.callLog.latencyMs,
        status: pass5.callLog.status,
        ...(pass5.callLog.errorMessage !== undefined && {
          errorMessage: pass5.callLog.errorMessage,
        }),
      },
    });

    // Sprint 51 — deterministic homework truth overwrite. Pass 5
    // historically guessed `homeworkStatus` from transcript hints
    // because there was no DB source of truth. Now that sharing a
    // therapy script persists an ExerciseAssignment + the portal can
    // flip it COMPLETED, we read the latest assignment for the
    // client and replace whatever the LLM said with the truth.
    const briefBody = await applyHomeworkTruth(clientId, pass5.output.preSessionBrief);

    const completed = await prisma.preSessionBrief.update({
      where: { id: briefRow.id },
      data: {
        status: 'COMPLETED',
        body: briefBody as unknown as Prisma.InputJsonValue,
        totalCostInr: new Prisma.Decimal(pass5.callLog.costInr),
      },
    });

    await writeAudit({
      actorType: 'SYSTEM',
      action: 'PRE_SESSION_BRIEF_GENERATED',
      targetType: 'PreSessionBrief',
      targetId: completed.id,
      metadata: {
        clientId,
        lastSessionId,
        language,
        carryoverCrisisCount: pass5.output.preSessionBrief.carryoverCrisis.length,
        costInr: pass5.callLog.costInr,
      },
    });

    return NextResponse.json({ brief: toPreSessionBrief(completed), source: 'fresh' });
  } catch (e) {
    const message = (e as Error).message;
    await prisma.preSessionBrief.update({
      where: { id: briefRow.id },
      data: { status: 'FAILED', errorMessage: message },
    });
    console.error(`[pre-session-brief] clientId=${clientId} failed: ${message}`);
    return NextResponse.json({ error: `Pass 5 failed: ${message}` }, { status: 502 });
  }
}

// ============================================================================
// Helpers.
// ============================================================================

// Sprint 50 — `fetchOpenCrises` + `OpenCrisis` were lifted into the
// shared `apps/web/lib/crisis-flags.ts` so the Prepare panel on the
// Today screen can call the same logic without duplicating it. This
// route imports them at the top.

function extractLastSummary(
  session: {
    noteDraft: { content: unknown } | null;
    therapyNote: { content: unknown } | null;
  } | null,
): string | null {
  const noteContent = session?.therapyNote?.content ?? session?.noteDraft?.content ?? null;
  if (!noteContent || typeof noteContent !== 'object') return null;
  const note = noteContent as Record<string, unknown>;
  const subjective = typeof note['subjective'] === 'string' ? (note['subjective'] as string) : '';
  const assessment = typeof note['assessment'] === 'string' ? (note['assessment'] as string) : '';
  const plan = typeof note['plan'] === 'string' ? (note['plan'] as string) : '';
  return (
    [
      subjective && `S: ${truncate(subjective, 300)}`,
      assessment && `A: ${truncate(assessment, 300)}`,
      plan && `P: ${truncate(plan, 300)}`,
    ]
      .filter(Boolean)
      .join(' | ') || null
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Sprint 51 — replace the LLM's homework guess with DB truth.
 *
 * Pre-S51 the route had no way to know whether homework was done — it
 * relied on Pass 5 inferring from transcript text, which was both
 * costly (it had to read the transcript) and unreliable. Now that
 * sharing a therapy script auto-persists an ExerciseAssignment and
 * the portal flips it COMPLETED, the latest assignment for the
 * client carries the only ground truth that matters. We look it up,
 * pick a deterministic description (customDescription for script-
 * sourced rows, catalog id fallback for catalog rows, free-text
 * therapistNote as a last resort) and overwrite the brief body in
 * place. No prompt changes; no Pass 5 backend changes.
 */
async function applyHomeworkTruth<T extends { homeworkStatus: unknown }>(
  clientId: string,
  brief: T,
): Promise<T> {
  const latest = await prisma.exerciseAssignment.findFirst({
    where: { clientId },
    orderBy: { assignedAt: 'desc' },
    select: {
      status: true,
      customDescription: true,
      therapistNote: true,
      exerciseId: true,
    },
  });
  if (!latest) {
    // No assignment yet; trust whatever the LLM said (or null if it
    // had nothing to go on).
    return brief;
  }
  const outcome: 'completed' | 'partial' | 'skipped' | 'unknown' =
    latest.status === 'COMPLETED'
      ? 'completed'
      : latest.status === 'SKIPPED' || latest.status === 'EXPIRED'
        ? 'skipped'
        : 'unknown';
  const description =
    latest.customDescription?.trim() ||
    latest.therapistNote?.trim() ||
    latest.exerciseId ||
    'Homework';
  return {
    ...brief,
    homeworkStatus: {
      description,
      outcome,
      notes: null,
    },
  };
}
