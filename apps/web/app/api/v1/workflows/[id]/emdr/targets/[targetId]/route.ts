import { NextResponse, type NextRequest } from 'next/server';
import { UpdateEmdrTargetInputSchema, type EmdrTarget } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import type { EmdrTarget as EmdrTargetRow } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/workflows/[id]/emdr/targets/[targetId] — record SUDS /
 * VOC progress, status moves, or bilateral-set counters on a target
 * during a session. Partial: any subset of the schema's fields can
 * be sent.
 *
 * `progressNote` is appended (with a date prefix) to EmdrTarget.notes
 * rather than overwriting — matches the contract author's intent that
 * the notes column accumulates a session-by-session log.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; targetId: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id, targetId } = await params;
  const body = await parseJson(req, UpdateEmdrTargetInputSchema);
  if (!body.ok) return body.response;

  const state = await prisma.modalityState.findUnique({
    where: { id },
    select: { id: true, psychologistId: true, modality: true },
  });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  if (state.modality !== 'EMDR') {
    return NextResponse.json({ error: 'EMDR-only' }, { status: 422 });
  }

  const existing = await prisma.emdrTarget.findUnique({ where: { id: targetId } });
  if (!existing || existing.stateId !== state.id) {
    return NextResponse.json({ error: 'Target not found' }, { status: 404 });
  }

  const dateTag = new Date().toISOString().slice(0, 10);
  const appendedNotes = body.value.progressNote
    ? `${existing.notes ? existing.notes + '\n\n' : ''}[${dateTag}] ${body.value.progressNote}`
    : existing.notes;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.emdrTarget.update({
      where: { id: targetId },
      data: {
        ...(body.value.sudsCurrent !== undefined && { sudsCurrent: body.value.sudsCurrent }),
        ...(body.value.vocCurrent !== undefined && { vocCurrent: body.value.vocCurrent }),
        ...(body.value.status !== undefined && { status: body.value.status }),
        ...(body.value.bilateralSetsTotal !== undefined && {
          bilateralSetsTotal: body.value.bilateralSetsTotal,
        }),
        ...(body.value.progressNote !== undefined && { notes: appendedNotes }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'EMDR_TARGET_UPDATED',
        targetType: 'EmdrTarget',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          workflowId: state.id,
          changes: Object.keys(body.value),
          newStatus: row.status,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toEmdrTarget(updated));
}

function toEmdrTarget(row: EmdrTargetRow): EmdrTarget {
  return {
    id: row.id,
    stateId: row.stateId,
    label: row.label,
    image: row.image,
    negativeCognition: row.negativeCognition,
    positiveCognition: row.positiveCognition,
    vocStart: row.vocStart,
    vocCurrent: row.vocCurrent,
    sudsStart: row.sudsStart,
    sudsCurrent: row.sudsCurrent,
    emotion: row.emotion,
    bodyLocation: row.bodyLocation,
    status: row.status,
    bilateralSetsTotal: row.bilateralSetsTotal,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
