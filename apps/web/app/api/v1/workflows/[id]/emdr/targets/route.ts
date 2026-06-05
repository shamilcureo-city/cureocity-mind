import { NextResponse, type NextRequest } from 'next/server';
import {
  CreateEmdrTargetInputSchema,
  type EmdrTarget,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import type { EmdrTarget as EmdrTargetRow } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/workflows/[id]/emdr/targets — add a target memory to an
 * EMDR workflow. Sets ModalityState.state.hasTargets=true on first
 * create so the EMDR state machine's desensitization-or-later gate
 * (checkEmdrTransition's `hasTargets`) flips to true.
 *
 * GET — list targets for the workflow, newest first.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, CreateEmdrTargetInputSchema);
  if (!body.ok) return body.response;

  const state = await prisma.modalityState.findUnique({ where: { id } });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  if (state.modality !== 'EMDR') {
    return NextResponse.json({ error: 'targets are EMDR-only' }, { status: 422 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.emdrTarget.create({
      data: {
        stateId: state.id,
        label: body.value.label,
        image: body.value.image,
        negativeCognition: body.value.negativeCognition,
        positiveCognition: body.value.positiveCognition,
        vocStart: body.value.vocStart,
        sudsStart: body.value.sudsStart,
        emotion: body.value.emotion,
        bodyLocation: body.value.bodyLocation,
      },
    });
    // Flip hasTargets so future EMDR transitions can proceed past
    // preparation. Idempotent — safe to set again on subsequent
    // targets.
    const prevState = (state.state as Record<string, unknown>) ?? {};
    if (!prevState['hasTargets']) {
      await tx.modalityState.update({
        where: { id: state.id },
        data: {
          state: { ...prevState, hasTargets: true } as unknown as Parameters<typeof tx.modalityState.update>[0]['data']['state'],
        },
      });
    }
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'EMDR_TARGET_ADDED',
        targetType: 'EmdrTarget',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          workflowId: state.id,
          sudsStart: body.value.sudsStart,
          vocStart: body.value.vocStart,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toEmdrTarget(created), { status: 201 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const state = await prisma.modalityState.findUnique({
    where: { id },
    select: { id: true, psychologistId: true, modality: true },
  });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  if (state.modality !== 'EMDR') {
    return NextResponse.json({ items: [] });
  }

  const rows = await prisma.emdrTarget.findMany({
    where: { stateId: state.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ items: rows.map(toEmdrTarget) });
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
