import type { CareReportV1, CareRiskLevel } from '@cureocity/contracts';
import { PassCareReportBackendError } from '@cureocity/llm';
import { recordGeminiCall } from '@cureocity/observability/metrics';
import { writeAudit } from './audit';
import { caseFileJsonForReport, getCareCaseFile, stitchTranscript } from './care-case-file';
import { modelRouter } from './llm';
import { prisma } from './prisma';

/**
 * Cureocity Care — Pass 10 runner (AC4). Called from `after()` on the
 * /end route (the Pass-3 pattern) AND synchronously from the re-run route
 * (Vercel Hobby's 60 s cap can kill after() work — the report screen
 * polls and offers the sync path).
 *
 * Fan-out on completion (§5): CareReport upsert, CARE_REPORT_GENERATED
 * audit, CARE_PLAN_PROPOSED on INTAKE (and on REVIEW when goals were
 * revised), and — §2 layer 5 — a HIGH risk re-screen sets the safety
 * hold. All SYSTEM-actor writes: no human is in this loop.
 */

export interface RunCareReportResult {
  ok: boolean;
  reportId?: string;
  riskLevel?: CareRiskLevel;
  error?: string;
}

export async function runCareReport(careSessionId: string): Promise<RunCareReportResult> {
  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: {
      id: true,
      careUserId: true,
      kind: true,
      status: true,
      moodBefore: true,
      moodAfter: true,
      liveTranscript: true,
      careUser: { select: { id: true, preferredLanguage: true, status: true } },
    },
  });
  if (!session) return { ok: false, error: 'Session not found' };

  const transcriptText = stitchTranscript(session.liveTranscript);
  if (!transcriptText) {
    return { ok: false, error: 'No mirrored transcript to report on' };
  }

  const caseFile = await getCareCaseFile(session.careUserId);
  const verdictsJson =
    session.kind === 'REVIEW' && caseFile.verdicts.length > 0
      ? JSON.stringify(caseFile.verdicts)
      : undefined;

  let report: CareReportV1;
  try {
    const result = await modelRouter().passCareReport({
      careSessionId,
      kind: session.kind,
      transcriptText,
      caseFileJson: caseFileJsonForReport(caseFile, session.moodBefore, session.moodAfter),
      verdictsJson,
      language: session.careUser.preferredLanguage,
    });
    report = result.output.report;
    await persistCallLog(result.callLog);
  } catch (e) {
    if (e instanceof PassCareReportBackendError) {
      await persistCallLog(e.callLog);
    }
    return { ok: false, error: (e as Error).message };
  }

  const riskLevel = extractRiskLevel(report);
  const row = await prisma.$transaction(async (tx) => {
    const upserted = await tx.careReport.upsert({
      where: { careSessionId },
      create: {
        careSessionId,
        kind: session.kind,
        body: report as unknown as object,
        riskLevel,
      },
      update: { body: report as unknown as object, riskLevel },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'CARE_REPORT_GENERATED',
        targetType: 'CareReport',
        targetId: upserted.id,
        metadata: { kind: session.kind, riskLevel },
      },
      tx,
    );
    if (
      report.kind === 'INTAKE' ||
      (report.kind === 'REVIEW' && report.progressReview.revisedGoals.length > 0)
    ) {
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'CARE_PLAN_PROPOSED',
          targetType: 'CareSession',
          targetId: careSessionId,
          metadata: { kind: report.kind },
        },
        tx,
      );
    }
    // CG1 — persist per-goal outcomes onto the CURRENT plan's goals JSON.
    // Status is the goal's LIVE field (CarePlanGoalSchema: "proposal fields
    // + live status") — updating it never re-versions the plan, mirroring
    // the therapist-side TreatmentGoalProgress rule. The review walked the
    // goals with the user in-session; ACHIEVED here is their own verdict,
    // and it's what lets the home strikethrough actually fire.
    if (report.kind === 'REVIEW' && report.progressReview.goalOutcomes.length > 0) {
      const currentPlan = await tx.carePlan.findFirst({
        where: { careUserId: session.careUserId },
        orderBy: { version: 'desc' },
        select: { id: true, goals: true },
      });
      if (currentPlan && Array.isArray(currentPlan.goals)) {
        const goals = currentPlan.goals as Array<Record<string, unknown>>;
        let changed = false;
        for (const outcome of report.progressReview.goalOutcomes) {
          const goal = goals[outcome.goalIndex];
          if (goal && outcome.status === 'ACHIEVED' && goal['status'] !== 'ACHIEVED') {
            goal['status'] = 'ACHIEVED';
            changed = true;
          }
        }
        if (changed) {
          await tx.carePlan.update({
            where: { id: currentPlan.id },
            data: { goals: goals as unknown as object },
          });
        }
      }
    }
    return upserted;
  });

  // CG6 — graduation is SUCCESS (docs/CARE_GROWTH_SYSTEM.md §9 #10): a
  // STEP_DOWN review with reliable improvement stops Plus billing
  // PROACTIVELY and marks the account graduated (outbound goes silent —
  // the nudge cron skips graduates). The threshold is the review's own
  // recommendation, which is clinician-governed copy: never soften it.
  if (
    report.kind === 'REVIEW' &&
    report.progressReview.recommendation === 'STEP_DOWN' &&
    report.progressReview.verdicts.some(
      (v) => v.verdict.includes('improvement') || v.verdict.includes('remission'),
    )
  ) {
    const user = await prisma.careUser.findUnique({
      where: { id: session.careUserId },
      select: { graduatedAt: true },
    });
    if (!user?.graduatedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.careUser.update({
          where: { id: session.careUserId },
          data: { graduatedAt: new Date(), planExpiresAt: new Date() },
        });
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'CARE_GRADUATED',
            targetType: 'CareUser',
            targetId: session.careUserId,
            metadata: { careSessionId, recommendation: 'STEP_DOWN' },
          },
          tx,
        );
      });
    }
  }

  // §2 layer 5 — the post-session re-screen is a safety tripwire, not a
  // display value. HIGH risk locks sessions until the next-day check-in.
  if (riskLevel === 'HIGH' && session.careUser.status === 'ACTIVE') {
    await prisma.$transaction(async (tx) => {
      await tx.careUser.update({
        where: { id: session.careUserId },
        data: { status: 'SAFETY_HOLD', safetyHoldAt: new Date() },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'CARE_SAFETY_HOLD_SET',
          targetType: 'CareUser',
          targetId: session.careUserId,
          metadata: { cause: 'PASS_10_RISK_RESCREEN', careSessionId },
        },
        tx,
      );
    });
  }

  return { ok: true, reportId: row.id, riskLevel };
}

function extractRiskLevel(report: CareReportV1): CareRiskLevel {
  switch (report.kind) {
    case 'INTAKE':
      return report.assessmentAndPlan.riskScreen.level;
    case 'TREATMENT':
      return report.sessionReport.riskScreen.level;
    case 'REVIEW':
      return report.progressReview.riskScreen.level;
  }
}

interface CallLogShape {
  sessionId: string | null;
  pass: string;
  model: string;
  region: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costInr: number;
  latencyMs: number;
  status: string;
  errorMessage?: string;
}

async function persistCallLog(log: CallLogShape): Promise<void> {
  try {
    await prisma.geminiCallLog.create({
      data: {
        // Care sessions live in their own table; the FK column targets the
        // practitioner Session table, so the row stays unlinked and the
        // careSessionId travels nowhere — cost/latency accounting only.
        sessionId: null,
        pass: 'PASS_13_CARE_REPORT',
        model: log.model,
        region: log.region,
        promptVersion: log.promptVersion,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        costInr: log.costInr,
        latencyMs: log.latencyMs,
        status: log.status as 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CIRCUIT_OPEN',
        errorMessage: log.errorMessage ?? null,
      },
    });
    recordGeminiCall({
      pass: 'PASS_13_CARE_REPORT',
      status: log.status as 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CIRCUIT_OPEN',
      region: log.region,
      durationMs: log.latencyMs,
    });
  } catch (e) {
    console.error('[care] failed to persist Pass 10 call log', e);
  }
}
