import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { AcceptPlanSuggestionInputSchema, ClinicalReportV1Schema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { toClinicalReport } from '@/lib/clinical-mappers';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import {
  PlanSuggestionStateSchema,
  resolvePlanSuggestionDecision,
} from '@/lib/plan-suggestion-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revision-bound decisions: goal indexes refer only to an immutable base plan. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: reportId } = await params;
  const body = await parseJson(req, AcceptPlanSuggestionInputSchema);
  if (!body.ok) return body.response;
  const owned = await prisma.clinicalReport.findFirst({
    where: { id: reportId, psychologistId: auth.value.psychologistId },
    select: { sessionId: true },
  });
  if (!owned) return NextResponse.json({ error: 'Clinical report not found' }, { status: 404 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, owned.sessionId, auth.value.psychologistId);
      await tx.$queryRaw`SELECT "id" FROM "clinical_reports" WHERE "id" = ${reportId} FOR UPDATE`;
      const report = await tx.clinicalReport.findUniqueOrThrow({ where: { id: reportId } });
      const parsed = ClinicalReportV1Schema.safeParse(report.body);
      const state = PlanSuggestionStateSchema.safeParse(report.planSuggestionState);
      if (report.status !== 'COMPLETED' || !parsed.success || !state.success)
        throw new Error(
          'Regenerate the clinical analysis to bind these suggestions to the current treatment plan.',
        );
      const activePlan = await tx.treatmentPlan.findFirst({
        where: { clientId: report.clientId, supersededAt: null },
        orderBy: { version: 'desc' },
      });
      if (!activePlan)
        throw new Error('No active treatment plan. Review the client’s Plan of care first.');
      const decision = resolvePlanSuggestionDecision({
        state: state.data,
        suggestions: parsed.data.planSuggestions,
        requestedIndexes: body.value.suggestionIndexes ?? [body.value.suggestionIndex!],
        revision: body.value.revision,
        expectedPlanId: body.value.expectedPlanId,
        activePlanId: activePlan.id,
      });
      if (decision.duplicate) return { report, version: activePlan.version, duplicate: true };
      const confirmedAt = new Date();
      const claimed = await tx.treatmentPlan.updateMany({
        where: { id: activePlan.id, supersededAt: null },
        data: { supersededAt: confirmedAt },
      });
      if (claimed.count !== 1)
        throw new Error('The treatment plan changed. Reload before applying suggestions.');
      const max = await tx.treatmentPlan.aggregate({
        where: { clientId: report.clientId },
        _max: { version: true },
      });
      const next = await tx.treatmentPlan.create({
        data: {
          clientId: report.clientId,
          psychologistId: auth.value.psychologistId,
          sourceSessionId: report.sessionId,
          sourceClinicalReportId: report.id,
          version: (max._max.version ?? 0) + 1,
          body: decision.plan as unknown as Prisma.InputJsonValue,
          confirmedAt,
          confirmedByPsychologistId: auth.value.psychologistId,
        },
      });
      const updated = await tx.clinicalReport.update({
        where: { id: report.id },
        data: {
          planSuggestionState: {
            ...state.data,
            currentPlanId: next.id,
            appliedIndexes: decision.appliedIndexes,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'PLAN_CONFIRMED',
          targetType: 'TreatmentPlan',
          targetId: next.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clinicalReportId: report.id,
            sessionId: report.sessionId,
            clientId: report.clientId,
            version: next.version,
            source: 'PLAN_SUGGESTION',
            suggestionIndexes: decision.appliedIndexes,
            basePlanId: state.data.basePlanId,
          },
        },
        tx,
      );
      return { report: updated, version: next.version, duplicate: false };
    });
    return NextResponse.json({
      ok: true,
      version: result.version,
      duplicate: result.duplicate,
      report: toClinicalReport(result.report),
    });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Clinical report not found' }, { status: 404 });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code !== 'P2002' && error.code !== 'P2025') throw error;
      return NextResponse.json(
        { error: 'The plan changed concurrently. Reload before applying suggestions.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not apply this decision. Reload and try again.',
      },
      { status: 409 },
    );
  }
}
