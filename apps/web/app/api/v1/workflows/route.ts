import { NextResponse, type NextRequest } from 'next/server';
import { CreateWorkflowInputSchema, type ModalityStateWithHistory } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toModalityStateWithHistory } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { ClientPhiWriteForbiddenError, lockActiveClient } from '@/lib/phi-write-lock';
import {
  CBT_PHASES,
  EMDR_PHASES,
  checkEmdrWorkflowStart,
  isCbtPhase,
  isEmdrPhase,
} from '@cureocity/clinical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class WorkflowAlreadyExistsError extends Error {}

/**
 * POST /api/v1/workflows — start a modality state machine for a client.
 *
 * One workflow per client at a time (ModalityState.clientId is UNIQUE
 * in the schema, modelling "a client is doing CBT OR EMDR, not both").
 * If the client already has one, returns 409 — caller is expected to
 * complete or abandon the existing workflow first.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, CreateWorkflowInputSchema);
  if (!body.ok) return body.response;

  // Validate the initialPhase against the modality's canonical phase list.
  // The schema layer leaves the phase as free-text because different
  // modalities have different phase sets; clinical package enforces.
  const phaseOk =
    (body.value.modality === 'CBT' && isCbtPhase(body.value.initialPhase)) ||
    (body.value.modality === 'EMDR' && isEmdrPhase(body.value.initialPhase));
  if (!phaseOk) {
    const valid = body.value.modality === 'CBT' ? CBT_PHASES : EMDR_PHASES;
    return NextResponse.json(
      {
        error: `initialPhase '${body.value.initialPhase}' is not a valid ${body.value.modality} phase. Valid: ${valid.join(', ')}`,
      },
      { status: 400 },
    );
  }

  // Ownership check on the client.
  const client = await prisma.client.findUnique({
    where: { id: body.value.clientId },
    select: {
      id: true,
      psychologistId: true,
      deletedAt: true,
      modalityState: { select: { id: true } },
    },
  });
  if (!client || client.deletedAt || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.modalityState) {
    return NextResponse.json(
      { error: 'Client already has an active workflow. Complete it before starting a new one.' },
      { status: 409 },
    );
  }

  if (body.value.modality === 'EMDR') {
    const start = checkEmdrWorkflowStart(body.value.initialPhase);
    if (!start.allowed) {
      return NextResponse.json(
        {
          code: 'EMDR_INITIAL_PHASE_REQUIRED',
          error:
            'Start a new EMDR workflow at history taking. Starting from prior care is not available yet; existing records are unchanged.',
        },
        { status: 422 },
      );
    }
  }

  const goalsForDb = body.value.goals.map((g, i) => ({
    id: g.id || `goal-${Date.now()}-${i}`,
    description: g.description,
    ...(g.targetSessionCount !== undefined && { targetSessionCount: g.targetSessionCount }),
    achieved: g.achieved ?? false,
    ...(g.evidence !== undefined && { evidence: g.evidence }),
  }));

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // Erasure uses the same Client lock. Recheck after acquiring it, then
      // serialize duplicate starts before attaching any new clinical content.
      await lockActiveClient(tx, body.value.clientId, auth.value.psychologistId);
      const existing = await tx.modalityState.findUnique({
        where: { clientId: body.value.clientId },
        select: { id: true },
      });
      if (existing) throw new WorkflowAlreadyExistsError();
      const row = await tx.modalityState.create({
        data: {
          clientId: body.value.clientId,
          psychologistId: auth.value.psychologistId,
          modality: body.value.modality,
          currentPhase: body.value.initialPhase,
          state: {},
          goals: goalsForDb,
        },
        include: { transitions: { orderBy: { occurredAt: 'asc' } } },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'WORKFLOW_CREATED',
          targetType: 'ModalityState',
          targetId: row.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: body.value.clientId,
            modality: body.value.modality,
            initialPhase: body.value.initialPhase,
            goalCount: goalsForDb.length,
          },
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    if (error instanceof WorkflowAlreadyExistsError) {
      return NextResponse.json(
        { error: 'Client already has an active workflow. Complete it before starting a new one.' },
        { status: 409 },
      );
    }
    throw error;
  }

  const response: ModalityStateWithHistory = toModalityStateWithHistory(created);
  return NextResponse.json(response, { status: 201 });
}
