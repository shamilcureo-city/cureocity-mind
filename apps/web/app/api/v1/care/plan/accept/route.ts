import { NextResponse, type NextRequest } from 'next/server';
import { AcceptCarePlanInputSchema, type CarePlanGoal } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/care/plan/accept (AC4, §5) — plan acceptance is a USER
 * action, never a model action. The INTAKE / REVIEW report only
 * proposes; this route persists the (possibly user-edited) goals as a
 * new IMMUTABLE CarePlan version — the confirm-before-persist rule the
 * practitioner co-pilot uses for Pass-3 suggestions.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, AcceptCarePlanInputSchema);
  if (!input.ok) return input.response;

  const source = await prisma.careSession.findUnique({
    where: { id: input.value.sourceSessionId },
    select: {
      id: true,
      careUserId: true,
      kind: true,
      report: { select: { kind: true, body: true } },
    },
  });
  if (!source || source.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Source session not found' }, { status: 404 });
  }
  if (!source.report || (source.report.kind !== 'INTAKE' && source.report.kind !== 'REVIEW')) {
    return NextResponse.json(
      { error: 'Only an intake or review report can propose a plan' },
      { status: 409 },
    );
  }

  // Formulation: from the INTAKE report; a REVIEW revision carries the
  // existing formulation forward (the review revises goals, not story).
  let formulation = '';
  const body = source.report.body as Record<string, unknown>;
  const ap = body['assessmentAndPlan'] as Record<string, unknown> | undefined;
  if (typeof ap?.['formulation'] === 'string') {
    formulation = ap['formulation'];
  } else {
    const current = await prisma.carePlan.findFirst({
      where: { careUserId: auth.value.careUserId },
      orderBy: { version: 'desc' },
      select: { formulation: true },
    });
    formulation = typeof current?.formulation === 'string' ? current.formulation : '';
  }

  const goals: CarePlanGoal[] = input.value.goals.map((g) => ({
    goal: g.goal,
    why: String(g.why ?? ''),
    measure: String(g.measure ?? ''),
    status: 'ACTIVE',
  }));

  const plan = await prisma.$transaction(async (tx) => {
    const latest = await tx.carePlan.findFirst({
      where: { careUserId: auth.value.careUserId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    const created = await tx.carePlan.create({
      data: {
        careUserId: auth.value.careUserId,
        version,
        formulation,
        goals: goals as unknown as object,
        modalityTrack: input.value.modalityTrack,
        cadence: input.value.cadence,
        sourceSessionId: source.id,
        acceptedAt: new Date(),
      },
    });
    if (version === 1) {
      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'CARE_PLAN_ACCEPTED',
          targetType: 'CarePlan',
          targetId: created.id,
          metadata: { ...auditMetadataFromRequest(req), version, goals: goals.length },
        },
        tx,
      );
    } else {
      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'CARE_PLAN_REVISED',
          targetType: 'CarePlan',
          targetId: created.id,
          metadata: { ...auditMetadataFromRequest(req), version, goals: goals.length },
        },
        tx,
      );
    }
    return created;
  });

  return NextResponse.json({
    id: plan.id,
    version: plan.version,
    goals,
    modalityTrack: plan.modalityTrack,
    cadence: plan.cadence,
  });
}
