import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  AcceptPlanSuggestionInputSchema,
  ClinicalReportV1Schema,
  ClinicalTreatmentPlanSchema,
  type ClinicalPlanSuggestion,
  type ClinicalTreatmentPlan,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clinical-reports/[id]/plan-suggestion
 *
 * Plan-as-diff (copilot IA redesign R3). Applies one — or, with
 * `suggestionIndexes`, several at once — of the report's `planSuggestions`
 * (typed edits: add / revise / remove a goal, adjust duration, change
 * modality) to the client's ACTIVE treatment plan, producing ONE new plan
 * version. The therapist's plan is never replaced wholesale, and a batch is
 * atomic: if any suggestion cannot apply, nothing is versioned. goalIndex
 * references are interpreted against the plan as it stood BEFORE the batch
 * (revise first, then remove in descending index order, then add), so
 * "apply all" means what the therapist read on screen. Versioned like any
 * other plan confirmation (audited `PLAN_CONFIRMED`). Tenant-checked,
 * POST-only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: reportId } = await params;

  const body = await parseJson(req, AcceptPlanSuggestionInputSchema);
  if (!body.ok) return body.response;

  const report = await prisma.clinicalReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      sessionId: true,
      clientId: true,
      psychologistId: true,
      status: true,
      body: true,
    },
  });
  if (!report || report.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Clinical report not found' }, { status: 404 });
  }
  if (report.status !== 'COMPLETED' || !report.body) {
    return NextResponse.json({ error: `Report is ${report.status}.` }, { status: 409 });
  }
  const parsedReport = ClinicalReportV1Schema.safeParse(report.body);
  if (!parsedReport.success) {
    return NextResponse.json(
      { error: 'Report body is not a treatment-report (no plan suggestions).' },
      { status: 409 },
    );
  }
  const indexes =
    body.value.suggestionIndexes ??
    (body.value.suggestionIndex !== undefined ? [body.value.suggestionIndex] : []);
  const unique = [...new Set(indexes)];
  const suggestions = unique.map((i) => parsedReport.data.planSuggestions[i]);
  if (suggestions.length === 0 || suggestions.some((s) => s === undefined)) {
    return NextResponse.json({ error: 'Suggestion index out of range.' }, { status: 422 });
  }
  const chosen = suggestions as ClinicalPlanSuggestion[];

  const activePlan = await prisma.treatmentPlan.findFirst({
    where: { clientId: report.clientId, supersededAt: null },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, body: true },
  });
  if (!activePlan) {
    return NextResponse.json(
      { error: 'No active plan to edit — accept a full plan first.' },
      { status: 409 },
    );
  }
  const parsedPlan = ClinicalTreatmentPlanSchema.safeParse(activePlan.body);
  if (!parsedPlan.success) {
    return NextResponse.json({ error: 'Active plan failed validation.' }, { status: 422 });
  }

  const applied = applySuggestions(parsedPlan.data, chosen);
  if (!applied.ok) {
    return NextResponse.json({ error: applied.error }, { status: 422 });
  }
  // The edited plan must still be a valid plan body.
  const validated = ClinicalTreatmentPlanSchema.safeParse(applied.plan);
  if (!validated.success) {
    return NextResponse.json(
      { error: 'Applying this suggestion would produce an invalid plan.' },
      { status: 422 },
    );
  }

  const confirmedAt = new Date();
  const created = await prisma.$transaction(async (tx) => {
    await tx.treatmentPlan.updateMany({
      where: { clientId: report.clientId, supersededAt: null },
      data: { supersededAt: confirmedAt },
    });
    const max = await tx.treatmentPlan.aggregate({
      where: { clientId: report.clientId },
      _max: { version: true },
    });
    const nextVersion = (max._max.version ?? 0) + 1;
    const row = await tx.treatmentPlan.create({
      data: {
        clientId: report.clientId,
        psychologistId: auth.value.psychologistId,
        sourceSessionId: report.sessionId,
        sourceClinicalReportId: report.id,
        version: nextVersion,
        body: validated.data as unknown as Prisma.InputJsonValue,
        confirmedAt,
        confirmedByPsychologistId: auth.value.psychologistId,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'PLAN_CONFIRMED',
        targetType: 'TreatmentPlan',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clinicalReportId: report.id,
          sessionId: report.sessionId,
          clientId: report.clientId,
          version: nextVersion,
          source: 'PLAN_SUGGESTION',
          suggestionTypes: chosen.map((c) => c.type),
          suggestionCount: chosen.length,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json({ ok: true, version: created.version }, { status: 200 });
}

type ApplyResult = { ok: true; plan: ClinicalTreatmentPlan } | { ok: false; error: string };

/**
 * Apply a batch against the plan the therapist was LOOKING at: revisions
 * first (indexes untouched), removals in descending index order (so earlier
 * removals don't shift later ones), additions after, scalar changes last.
 */
function applySuggestions(
  plan: ClinicalTreatmentPlan,
  batch: ClinicalPlanSuggestion[],
): ApplyResult {
  const revises = batch.filter((s) => s.type === 'REVISE_GOAL');
  const removes = batch
    .filter((s) => s.type === 'REMOVE_GOAL')
    .sort((a, b) => (b.goalIndex ?? 0) - (a.goalIndex ?? 0));
  const rest = batch.filter((s) => s.type !== 'REVISE_GOAL' && s.type !== 'REMOVE_GOAL');
  let current = plan;
  for (const s of [...revises, ...removes, ...rest]) {
    const step = applySuggestion(current, s);
    if (!step.ok) return step;
    current = step.plan;
  }
  return { ok: true, plan: current };
}

function applySuggestion(plan: ClinicalTreatmentPlan, s: ClinicalPlanSuggestion): ApplyResult {
  const goals = [...plan.goals];
  switch (s.type) {
    case 'ADD_GOAL':
      if (!s.goal) return { ok: false, error: 'ADD_GOAL has no goal.' };
      if (goals.length >= 8) return { ok: false, error: 'Plan already has the maximum 8 goals.' };
      goals.push(s.goal);
      return { ok: true, plan: { ...plan, goals } };
    case 'REVISE_GOAL':
      if (!s.goal) return { ok: false, error: 'REVISE_GOAL has no goal.' };
      if (s.goalIndex === null || s.goalIndex >= goals.length)
        return { ok: false, error: 'REVISE_GOAL index out of range.' };
      goals[s.goalIndex] = s.goal;
      return { ok: true, plan: { ...plan, goals } };
    case 'REMOVE_GOAL':
      if (s.goalIndex === null || s.goalIndex >= goals.length)
        return { ok: false, error: 'REMOVE_GOAL index out of range.' };
      if (goals.length <= 1) return { ok: false, error: 'A plan must keep at least one goal.' };
      goals.splice(s.goalIndex, 1);
      return { ok: true, plan: { ...plan, goals } };
    case 'ADJUST_DURATION':
      if (s.expectedDurationSessions === null)
        return { ok: false, error: 'ADJUST_DURATION has no duration.' };
      return { ok: true, plan: { ...plan, expectedDurationSessions: s.expectedDurationSessions } };
    case 'CHANGE_MODALITY':
      if (s.modality === null) return { ok: false, error: 'CHANGE_MODALITY has no modality.' };
      return { ok: true, plan: { ...plan, modality: s.modality } };
  }
}
