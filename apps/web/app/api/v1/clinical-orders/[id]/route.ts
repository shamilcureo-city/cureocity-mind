import { NextResponse, type NextRequest } from 'next/server';
import { UpdateClinicalOrderInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { toClinicalOrderDTO } from '@/lib/order-mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Sprint DV5 — PATCH /api/v1/clinical-orders/:id
 *
 * The doctor confirms a drafted lab / imaging / referral / procedure
 * order or discards it. Tenant-checked by the order's psychologistId.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const parsed = await parseJson(req, UpdateClinicalOrderInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  const order = await prisma.clinicalOrder.findUnique({ where: { id } });
  if (!order || order.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Clinical order not found' }, { status: 404 });
  }

  if (input.status === 'DISCARDED') {
    const updated = await prisma.clinicalOrder.update({
      where: { id },
      data: { status: 'DISCARDED' },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'CLINICAL_ORDER_DISCARDED',
      targetType: 'ClinicalOrder',
      targetId: id,
      metadata: { sessionId: order.sessionId, ...auditMetadataFromRequest(req) },
    });
    return NextResponse.json(toClinicalOrderDTO(updated));
  }

  const updated = await prisma.clinicalOrder.update({
    where: { id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLINICAL_ORDER_CONFIRMED',
    targetType: 'ClinicalOrder',
    targetId: id,
    metadata: { sessionId: order.sessionId, ...auditMetadataFromRequest(req) },
  });
  return NextResponse.json(toClinicalOrderDTO(updated));
}
