import { NextResponse, type NextRequest } from 'next/server';
import { requireCareUserId } from '@/lib/care-auth';
import { getCareCaseFile, inferKindFromCaseFile } from '@/lib/care-case-file';
import { effectiveCareTier, evaluateCareGate, CARE_TIER_WEEKLY_CAP } from '@/lib/care-gate';
import { evaluateCareSuppression } from '@/lib/care-suppression';
import { crisisResources } from '@/lib/care-safety';
import { computeCareStreak, computeCareWeeks, istDayKey } from '@/lib/care-streak';
import { CARE_SESSION_CAP_MIN } from '@cureocity/llm';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/care/home (AC2) — everything the home screen needs in one
 * round-trip: the kind-aware next-session card + gate verdict (in plain
 * words), the plan card, homework, streak, today's check-in state, the
 * last report headline, and the always-present safety strip resources.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUser, careUserId } = auth.value;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [caseFile, weekSessions, oldestWeekSession, checkins, lastReport, lastCrisis] =
    await Promise.all([
      getCareCaseFile(careUserId),
      prisma.careSession.count({
        where: {
          careUserId,
          createdAt: { gte: weekAgo },
          status: { in: ['COMPLETED', 'IN_PROGRESS'] },
        },
      }),
      prisma.careSession.findFirst({
        where: {
          careUserId,
          createdAt: { gte: weekAgo },
          status: { in: ['COMPLETED', 'IN_PROGRESS'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.careCheckin.findMany({
        where: { careUserId },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: { mood: true, createdAt: true },
      }),
      prisma.careReport.findFirst({
        where: { careSession: { careUserId } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          body: true,
          careSessionId: true,
          createdAt: true,
          riskLevel: true,
        },
      }),
      prisma.careSession.findFirst({
        where: { careUserId, crisisAt: { not: null } },
        orderBy: { crisisAt: 'desc' },
        select: { crisisAt: true },
      }),
    ]);

  const gate = evaluateCareGate({
    status: careUser.status,
    onboardedAt: careUser.onboardedAt,
    planTier: careUser.planTier,
    planExpiresAt: careUser.planExpiresAt,
    sessionsThisWeek: weekSessions,
    oldestWeekSessionAt: oldestWeekSession?.createdAt ?? null,
  });

  // CG3 — the ONE suppression predicate (ethics charter #2): when true, NO
  // commerce renders anywhere, including the graceful cap's quiet offer.
  const suppression = evaluateCareSuppression({
    status: careUser.status,
    safetyHoldAt: careUser.safetyHoldAt,
    lastCrisisAt: lastCrisis?.crisisAt ?? null,
    latestRiskLevel: lastReport?.riskLevel ?? null,
    worseningVerdict: caseFile.worseningVerdict,
    recentMoods: checkins.slice(0, 6).map((c) => c.mood),
  });
  const kind = inferKindFromCaseFile(caseFile);

  const [completedSessionDates, allCheckinDates, homeworkTickToday, homeworkTicksWeek] =
    await Promise.all([
      prisma.careSession.findMany({
        where: { careUserId, status: 'COMPLETED' },
        select: { endedAt: true },
      }),
      prisma.careCheckin.findMany({ where: { careUserId }, select: { createdAt: true } }),
      prisma.careHomeworkTick.findFirst({
        where: { careUserId, istDay: istDayKey(new Date()) },
        select: { id: true },
      }),
      prisma.careHomeworkTick.count({
        where: { careUserId, createdAt: { gte: weekAgo } },
      }),
    ]);
  const sessionDates = completedSessionDates
    .map((s) => s.endedAt)
    .filter((d): d is Date => d !== null);
  const streak = computeCareStreak([...checkins.map((c) => c.createdAt), ...sessionDates]);
  // CG4 — the showing-up record (streak v2): counts UP, auto-bridges thin
  // weeks, and FREEZES under a safety hold ("you matter more than a
  // streak" is mechanical now, not just copy).
  const record =
    careUser.status === 'ACTIVE'
      ? computeCareWeeks({
          sessionDates,
          checkinDates: allCheckinDates.map((c) => c.createdAt),
        })
      : null;

  const todayKey = istDayKey(new Date());
  const checkinToday = checkins.some((c) => istDayKey(c.createdAt) === todayKey);

  // CG4 — return celebration: a gap ≥7 days with real history gets a
  // welcome, never a measurement of the gap.
  const lastActivityMs = Math.max(
    checkins[0]?.createdAt.getTime() ?? 0,
    ...sessionDates.map((d) => d.getTime()),
    0,
  );
  const welcomeBack = lastActivityMs > 0 && Date.now() - lastActivityMs >= 7 * 24 * 60 * 60 * 1000;

  // CG1 — the measurement loop's home-side state: does ANY baseline exist
  // (drives the one gentle starting-line card), and is a fresh score
  // (≤72h) in hand before a REVIEW (the soft pre-review gate — the UI
  // honors it; a user who insists still gets their session).
  const [instrumentCount, freshInstrument] = await Promise.all([
    prisma.careInstrumentResponse.count({ where: { careUserId } }),
    kind === 'REVIEW'
      ? prisma.careInstrumentResponse.findFirst({
          where: { careUserId, createdAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  const hasBaseline = instrumentCount > 0;
  const needsCheckin = kind === 'REVIEW' && freshInstrument === null;

  // The server is the clock authority (IST) — the greeting must never say
  // "Good evening" at 9am in a product whose moat is honesty.
  const istHour = (new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours() + 24) % 24;

  let lastReportHeadline: string | null = null;
  if (lastReport) {
    const body = lastReport.body as Record<string, unknown>;
    const sr = body['sessionReport'] as Record<string, unknown> | undefined;
    const ap = body['assessmentAndPlan'] as Record<string, unknown> | undefined;
    const pr = body['progressReview'] as Record<string, unknown> | undefined;
    lastReportHeadline =
      (typeof sr?.['headline'] === 'string' && sr['headline']) ||
      (ap ? 'Your assessment & plan is ready.' : null) ||
      (typeof pr?.['narrative'] === 'string' && (pr['narrative'] as string).slice(0, 120)) ||
      null;
  }

  const tier = effectiveCareTier(careUser.planTier, careUser.planExpiresAt);
  const cap = CARE_TIER_WEEKLY_CAP[tier] ?? CARE_TIER_WEEKLY_CAP['free']!;

  return NextResponse.json({
    displayName: careUser.displayName,
    personaName: careUser.personaName,
    onboarded: careUser.onboardedAt !== null,
    status: careUser.status,
    planTier: careUser.planTier,
    gate,
    nextSession: {
      kind,
      sessionNumber: caseFile.completedCount + 1,
      capMin: CARE_SESSION_CAP_MIN[kind],
      modalityTrack: caseFile.plan?.modalityTrack ?? null,
    },
    sessionsThisWeek: weekSessions,
    weeklyCap: cap,
    istHour,
    hasBaseline,
    needsCheckin,
    effectiveTier: tier,
    suppressUpsell: suppression.suppress,
    nextUnlockAt: gate.nextUnlockAt ?? null,
    plan: caseFile.plan
      ? {
          version: caseFile.plan.version,
          goals: caseFile.plan.goals,
          modalityTrack: caseFile.plan.modalityTrack,
          cadence: caseFile.plan.cadence,
        }
      : null,
    homework: caseFile.homeworkLine ?? null,
    streak,
    record,
    welcomeBack,
    homeworkTickedToday: homeworkTickToday !== null,
    homeworkTicksThisWeek: homeworkTicksWeek,
    checkinToday,
    lastReport: lastReport
      ? {
          careSessionId: lastReport.careSessionId,
          kind: lastReport.kind,
          headline: lastReportHeadline,
          createdAt: lastReport.createdAt,
        }
      : null,
    resources: crisisResources(careUser.spokenLanguages),
    trustedContact: careUser.trustedContactName
      ? { name: careUser.trustedContactName, phone: careUser.trustedContactPhone }
      : null,
  });
}
