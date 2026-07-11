import { NextResponse, type NextRequest } from 'next/server';
import { AcceptIntakePlanInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint TSC-V2 — POST /api/v1/clinical-reports/[id]/intake-plan
 *
 * Create treatment-plan v1 from an INTAKE brief's suggested approaches. An
 * intake report produces no treatment plan (there's no diagnosis yet), so
 * the decision board lets the therapist draft one in the editor (seeded from
 * the differential + the approaches they ticked) and save it here. Mirrors
 * the sections route's applyPlanConfirmation: supersede the client's active
 * plan, create the next version, audit PLAN_CONFIRMED. Tenant-checked,
 * INTAKE-only, POST-only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: reportId } = await params;

  const body = await parseJson(req, AcceptIntakePlanInputSchema);
  if (!body.ok) return body.response;

  const report = await prisma.clinicalReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      sessionId: true,
      clientId: true,
      psychologistId: true,
      status: true,
      session: { select: { kind: true } },
    },
  });
  if (!report || report.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
  if (report.session.kind !== 'INTAKE') {
    return NextResponse.json(
      { error: 'Not an intake report — confirm the plan through the sections route.' },
      { status: 409 },
    );
  }
  if (report.status !== 'COMPLETED') {
    return NextResponse.json({ error: `Report is ${report.status}.` }, { status: 409 });
  }

  const plan = body.value.treatmentPlan;
  const confirmedAt = new Date();
  let version = 0;
  await prisma.$transaction(async (tx) => {
    // Same write as applyPlanConfirmation: supersede the prior active plan,
    // create the new one at max(version)+1. The (clientId, version) unique
    // constraint makes a concurrent double-save collide + retry rather than
    // fork the history.
    await tx.treatmentPlan.updateMany({
      where: { clientId: report.clientId, supersededAt: null },
      data: { supersededAt: confirmedAt },
    });
    const max = await tx.treatmentPlan.aggregate({
      where: { clientId: report.clientId },
      _max: { version: true },
    });
    version = (max._max.version ?? 0) + 1;
    const created = await tx.treatmentPlan.create({
      data: {
        clientId: report.clientId,
        psychologistId: auth.value.psychologistId,
        sourceSessionId: report.sessionId,
        sourceClinicalReportId: report.id,
        version,
        body: plan as unknown as Prisma.InputJsonValue,
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
        targetId: created.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clinicalReportId: report.id,
          sessionId: report.sessionId,
          clientId: report.clientId,
          version,
          modality: plan.modality,
          phaseCount: plan.phaseSequence.length,
          goalCount: plan.goals.length,
          source: 'INTAKE_BOARD',
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true, version }, { status: 200 });
}
