import { NextResponse, type NextRequest } from 'next/server';
import { CARE_PROTOCOL_STEPS } from '@cureocity/llm';
import { requireCareUserId } from '@/lib/care-auth';
import { getCareCaseFile, inferKindFromCaseFile } from '@/lib/care-case-file';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export type CareStage = 'GETTING_STARTED' | 'ASSESSMENT' | 'ACTIVE_WORK' | 'REVIEW_DUE';

/**
 * GET /api/v1/care/progress (AC5, S7) — the user's own journey: stage,
 * instrument series with the deterministic reliable-change verdicts (in
 * plain words), goals across plan versions, mood trend, session history.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUserId } = auth.value;

  const [caseFile, sessions, checkins, instrumentRows, plans] = await Promise.all([
    getCareCaseFile(careUserId),
    prisma.careSession.findMany({
      where: { careUserId, status: { in: ['COMPLETED', 'CRISIS_ESCALATED'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        kind: true,
        status: true,
        topic: true,
        moodBefore: true,
        moodAfter: true,
        endedAt: true,
        durationSec: true,
        report: { select: { id: true } },
      },
    }),
    prisma.careCheckin.findMany({
      where: { careUserId },
      orderBy: { createdAt: 'asc' },
      take: 180,
      select: { mood: true, createdAt: true },
    }),
    prisma.careInstrumentResponse.findMany({
      where: { careUserId },
      orderBy: { createdAt: 'asc' },
      select: { instrumentKey: true, totalScore: true, createdAt: true },
    }),
    prisma.carePlan.findMany({
      where: { careUserId },
      orderBy: { version: 'asc' },
      select: { version: true, goals: true, modalityTrack: true, acceptedAt: true },
    }),
  ]);

  const nextKind = inferKindFromCaseFile(caseFile);
  let stage: CareStage;
  if (!caseFile.plan) {
    stage = caseFile.completedCount === 0 ? 'GETTING_STARTED' : 'ASSESSMENT';
  } else {
    stage = nextKind === 'REVIEW' ? 'REVIEW_DUE' : 'ACTIVE_WORK';
  }

  const verdicts = caseFile.verdicts.map((v) => ({
    ...v,
    plainWords: plainWordsForVerdict(v.instrumentKey, v.verdict, v.baselineScore, v.latestScore),
  }));

  // CP-D — where they are in the method arc (progresses, then maintenance).
  const arcSteps = caseFile.plan ? (CARE_PROTOCOL_STEPS[caseFile.plan.modalityTrack] ?? null) : null;
  const arc = arcSteps
    ? {
        track: caseFile.plan!.modalityTrack,
        total: arcSteps.length,
        done: Math.min(caseFile.treatmentSessionsCompleted, arcSteps.length),
        complete: caseFile.treatmentSessionsCompleted >= arcSteps.length,
      }
    : null;

  return NextResponse.json({
    stage,
    plan: caseFile.plan,
    planHistory: plans,
    arc,
    verdicts,
    instrumentSeries: instrumentRows,
    moodSeries: [
      ...checkins.map((c) => ({ at: c.createdAt, mood: c.mood, source: 'checkin' as const })),
      ...sessions
        .filter((s) => s.moodAfter !== null && s.endedAt !== null)
        .map((s) => ({ at: s.endedAt!, mood: s.moodAfter!, source: 'session' as const })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    sessions,
  });
}

function plainWordsForVerdict(
  key: string,
  verdict: string,
  baseline: number,
  latest: number,
): string {
  const arc = `${baseline} → ${latest}`;
  switch (verdict) {
    case 'reliable_improvement':
      return `${key} ${arc} — reliably improved. This is real change, not noise.`;
    case 'deterioration':
      return `${key} ${arc} — the scores have moved the wrong way. Worth talking about, with a person too.`;
    default:
      return `${key} ${arc} — no reliable change yet. That's common mid-work; the trend matters more than any single score.`;
  }
}
