import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { SaveSafetyPlanInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toSafetyPlanRow } from '@/lib/clinical-mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/safety-plan
 *
 * Save (or replace) the client's active Stanley & Brown safety
 * plan. Existing active rows are superseded; the new row becomes
 * the active one. Audited as SAFETY_PLAN_CREATED for the first
 * plan and SAFETY_PLAN_UPDATED for replacements.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const body = await parseJson(req, SaveSafetyPlanInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const now = new Date();
  const existed = await prisma.safetyPlan.findFirst({
    where: { clientId, supersededAt: null },
    select: { id: true },
  });

  const row = await prisma.$transaction(async (tx) => {
    await tx.safetyPlan.updateMany({
      where: { clientId, supersededAt: null },
      data: { supersededAt: now },
    });
    return tx.safetyPlan.create({
      data: {
        clientId,
        psychologistId: auth.value.psychologistId,
        ...(body.value.sourceSessionId && { sourceSessionId: body.value.sourceSessionId }),
        language: body.value.body.language,
        body: body.value.body as unknown as Prisma.InputJsonValue,
        confirmedAt: now,
        confirmedByPsychologistId: auth.value.psychologistId,
      },
    });
  });

  if (existed) {
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'SAFETY_PLAN_UPDATED',
      targetType: 'SafetyPlan',
      targetId: row.id,
      metadata: {
        ...auditMetadataFromRequest(req),
        clientId,
        supersededPriorPlanId: existed.id,
        language: body.value.body.language,
      },
    });
  } else {
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'SAFETY_PLAN_CREATED',
      targetType: 'SafetyPlan',
      targetId: row.id,
      metadata: {
        ...auditMetadataFromRequest(req),
        clientId,
        language: body.value.body.language,
      },
    });
  }

  return NextResponse.json({ plan: toSafetyPlanRow(row) });
}

/**
 * GET /api/v1/clients/[id]/safety-plan — the active plan (or 404 if
 * none on file).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const row = await prisma.safetyPlan.findFirst({
    where: { clientId, supersededAt: null },
    orderBy: { confirmedAt: 'desc' },
  });
  if (!row) {
    return NextResponse.json({ error: 'No active safety plan' }, { status: 404 });
  }
  return NextResponse.json({ plan: toSafetyPlanRow(row) });
}
