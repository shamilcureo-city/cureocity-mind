import { NextResponse, type NextRequest } from 'next/server';
import {
  MedicationOrderV1Schema,
  UpdateMedicationOrderInputSchema,
  type MedicationOrderV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { toMedicationOrderDTO } from '@/lib/order-mappers';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Sprint DV5 — PATCH /api/v1/medication-orders/:id
 *
 * The doctor confirms a drafted Rx line (optionally editing dose /
 * frequency / duration / instructions first) or discards it. Confirming
 * is an explicit clinical act — nothing is ever auto-prescribed. The
 * interaction-check is re-run server-side over any edits (never trusts a
 * client-supplied warning). Tenant-checked by the order's psychologistId.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const parsed = await parseJson(req, UpdateMedicationOrderInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  const order = await prisma.medicationOrder.findUnique({ where: { id } });
  if (!order || order.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Medication order not found' }, { status: 404 });
  }

  if (input.status === 'DISCARDED') {
    const updated = await prisma.medicationOrder.update({
      where: { id },
      data: { status: 'DISCARDED' },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'MEDICATION_ORDER_DISCARDED',
      targetType: 'MedicationOrder',
      targetId: id,
      metadata: { sessionId: order.sessionId, ...auditMetadataFromRequest(req) },
    });
    return NextResponse.json(toMedicationOrderDTO(updated));
  }

  // CONFIRMED — apply any edits. The cross-drug interaction warnings were
  // computed server-side at draft time over the whole Rx; they are
  // preserved here (dose/frequency edits don't change the pair), and the
  // field stays server-owned (never read from the request body).
  const current = MedicationOrderV1Schema.safeParse(order.content);
  const base: MedicationOrderV1 = current.success
    ? current.data
    : { version: 'V1', drug: '(unreadable order)', prn: false, interactionWarnings: [] };
  const edited: MedicationOrderV1 = {
    ...base,
    ...(input.edits?.dose !== undefined && { dose: input.edits.dose }),
    ...(input.edits?.frequency !== undefined && { frequency: input.edits.frequency }),
    ...(input.edits?.durationDays !== undefined && { durationDays: input.edits.durationDays }),
    ...(input.edits?.instructions !== undefined && { instructions: input.edits.instructions }),
    interactionWarnings: base.interactionWarnings,
  };

  const updated = await prisma.medicationOrder.update({
    where: { id },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      content: edited as unknown as Prisma.InputJsonValue,
    },
  });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'MEDICATION_ORDER_CONFIRMED',
    targetType: 'MedicationOrder',
    targetId: id,
    metadata: {
      sessionId: order.sessionId,
      drug: edited.drug,
      edited: input.edits !== undefined,
      hadInteractionWarning: base.interactionWarnings.length > 0,
      ...auditMetadataFromRequest(req),
    },
  });
  return NextResponse.json(toMedicationOrderDTO(updated));
}
