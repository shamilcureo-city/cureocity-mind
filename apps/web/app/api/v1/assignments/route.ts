import { NextResponse, type NextRequest } from 'next/server';
import { CreateExerciseAssignmentInputSchema } from '@cureocity/contracts';
import { getExerciseById } from '@cureocity/clinical';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { assignmentDueAtMatches } from '@/lib/sprint5-final-behavior';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/assignments — therapist assigns a catalog exercise to
 * one of their clients. Validates the exerciseId against the unified
 * catalog from @cureocity/clinical so we never persist an unknown
 * exercise key. Status starts as PENDING; transitions are recorded
 * either by the client-web PWA (Sprint 8) or by the therapist via
 * PATCH /assignments/[id].
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCapability(req, 'THERAPY_WORKFLOWS');
  if (!auth.ok) return auth.response;
  if (auth.value.user.vertical !== 'THERAPIST') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const body = await parseJson(req, CreateExerciseAssignmentInputSchema);
  if (!body.ok) return body.response;

  try {
    if (body.value.exerciseId) getExerciseById(body.value.exerciseId);
  } catch {
    return NextResponse.json(
      { error: `Unknown exercise id '${body.value.exerciseId}'. Must be a catalog entry.` },
      { status: 400 },
    );
  }

  // Ownership check on the client.
  const client = await prisma.client.findUnique({
    where: { id: body.value.clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (body.value.sourceSessionId) {
    const session = await prisma.session.findFirst({
      where: {
        id: body.value.sourceSessionId,
        clientId: body.value.clientId,
        psychologistId: auth.value.psychologistId,
      },
      select: { id: true },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const lockedClients = await tx.$queryRaw<
        Array<{
          id: string;
          psychologistId: string;
          deletedAt: Date | null;
          status: 'ACTIVE' | 'PAUSED' | 'DISCHARGED' | 'TRANSFERRED';
        }>
      >`
        SELECT "id", "psychologistId", "deletedAt", "status"
        FROM "clients"
        WHERE "id" = ${body.value.clientId}
        FOR UPDATE
      `;
      const lockedClient = lockedClients[0];
      if (
        !lockedClient ||
        lockedClient.deletedAt !== null ||
        lockedClient.status !== 'ACTIVE' ||
        lockedClient.psychologistId !== auth.value.psychologistId
      ) {
        throw new AssignmentTargetNotFound('Client');
      }

      if (body.value.sourceSessionId) {
        const lockedSourceSessions = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT "id", "status"
          FROM "sessions"
          WHERE "id" = ${body.value.sourceSessionId}
            AND "clientId" = ${body.value.clientId}
            AND "psychologistId" = ${auth.value.psychologistId}
          FOR UPDATE
        `;
        if (!lockedSourceSessions[0]) throw new AssignmentTargetNotFound('Session');
        if (
          body.value.sourceAgreementId &&
          !['IN_PROGRESS', 'COMPLETED'].includes(lockedSourceSessions[0].status)
        )
          throw new AssignmentIdempotencyConflict();
      }

      if (body.value.idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${body.value.idempotencyKey}))`;
        const existing = await tx.exerciseAssignment.findUnique({
          where: { idempotencyKey: body.value.idempotencyKey },
        });
        if (existing) {
          const requested = normalizedAssignmentPayload(body.value, auth.value.psychologistId);
          if (!assignmentPayloadMatches(existing, requested))
            throw new AssignmentIdempotencyConflict();
          return existing;
        }
      }
      if (body.value.sourceAgreementId) {
        // Shared client lock serializes correction, retirement and erasure.
        const agreement = await tx.sessionAgreement.findFirst({
          where: {
            id: body.value.sourceAgreementId,
            sessionId: body.value.sourceSessionId,
            clientId: body.value.clientId,
            psychologistId: auth.value.psychologistId,
          },
        });
        if (!agreement) throw new AssignmentTargetNotFound('Agreement');
        const existing = await tx.exerciseAssignment.findFirst({
          where: {
            sourceAgreementId: agreement.id,
            sourceAgreementRevision: body.value.sourceAgreementRevision,
            clientId: body.value.clientId,
            psychologistId: auth.value.psychologistId,
          },
        });
        if (existing) {
          if (
            !assignmentPayloadMatches(
              existing,
              normalizedAssignmentPayload(body.value, auth.value.psychologistId),
            )
          )
            throw new AssignmentIdempotencyConflict();
          return existing;
        }
        if (
          agreement.revision !== body.value.sourceAgreementRevision ||
          agreement.retiredAt !== null ||
          agreement.followUp === 'DONE'
        )
          throw new AssignmentIdempotencyConflict();
      }
      const row = await tx.exerciseAssignment.create({
        data: {
          clientId: body.value.clientId,
          psychologistId: auth.value.psychologistId,
          exerciseId: body.value.exerciseId ?? null,
          source: body.value.task ? 'CUSTOM' : 'CATALOG',
          sourceSessionId: body.value.sourceSessionId ?? null,
          sourceAgreementId: body.value.sourceAgreementId ?? null,
          sourceAgreementRevision: body.value.sourceAgreementRevision ?? null,
          idempotencyKey: body.value.idempotencyKey ?? null,
          ...(body.value.task && { customDescription: body.value.task }),
          ...(body.value.frequency && { frequency: body.value.frequency }),
          ...(body.value.deliveryChannel && { deliveryChannel: body.value.deliveryChannel }),
          ...(body.value.dueAt && { dueAt: new Date(body.value.dueAt) }),
          ...(body.value.therapistNote !== undefined && {
            therapistNote: body.value.therapistNote,
          }),
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'EXERCISE_ASSIGNED',
          targetType: 'ExerciseAssignment',
          targetId: row.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: body.value.clientId,
            exerciseId: body.value.exerciseId ?? null,
            source: body.value.task ? 'CUSTOM' : 'CATALOG',
            ...(body.value.sourceAgreementId && {
              sourceAgreementId: body.value.sourceAgreementId,
              sourceAgreementRevision: body.value.sourceAgreementRevision,
            }),
            ...(body.value.deliveryChannel && { deliveryChannel: body.value.deliveryChannel }),
          },
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    if (error instanceof AssignmentTargetNotFound) {
      return NextResponse.json({ error: `${error.target} not found` }, { status: 404 });
    }
    if (error instanceof AssignmentIdempotencyConflict) {
      return NextResponse.json(
        {
          error:
            'The homework or source agreement has changed. Reload and review the saved wording and existing homework before retrying.',
        },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json(toExerciseAssignment(created), { status: 201 });
}

class AssignmentIdempotencyConflict extends Error {}

class AssignmentTargetNotFound extends Error {
  constructor(readonly target: 'Client' | 'Session' | 'Agreement') {
    super(`${target} not found`);
  }
}

type NormalizedAssignmentPayload = ReturnType<typeof normalizedAssignmentPayload>;

function normalizedAssignmentPayload(
  value: {
    clientId: string;
    exerciseId?: string | null;
    task?: string;
    sourceSessionId?: string;
    sourceAgreementId?: string;
    sourceAgreementRevision?: number;
    frequency?: string;
    deliveryChannel?: string;
    dueAt?: string;
    therapistNote?: string | null;
  },
  psychologistId: string,
) {
  return {
    psychologistId,
    clientId: value.clientId,
    exerciseId: value.exerciseId ?? null,
    source: value.task ? 'CUSTOM' : 'CATALOG',
    customDescription: value.task ?? null,
    sourceSessionId: value.sourceSessionId ?? null,
    sourceAgreementId: value.sourceAgreementId ?? null,
    sourceAgreementRevision: value.sourceAgreementRevision ?? null,
    frequency: value.frequency ?? null,
    deliveryChannel: value.deliveryChannel ?? null,
    dueAt: value.dueAt ? new Date(value.dueAt).toISOString() : null,
    therapistNote: value.therapistNote ?? null,
  };
}

function assignmentPayloadMatches(
  existing: {
    psychologistId: string;
    clientId: string;
    exerciseId: string | null;
    source: string;
    customDescription: string | null;
    sourceSessionId: string | null;
    sourceAgreementId?: string | null;
    sourceAgreementRevision?: number | null;
    frequency: string | null;
    deliveryChannel: string | null;
    dueAt: Date | null;
    therapistNote: string | null;
  },
  requested: NormalizedAssignmentPayload,
): boolean {
  return (
    existing.psychologistId === requested.psychologistId &&
    existing.clientId === requested.clientId &&
    existing.exerciseId === requested.exerciseId &&
    existing.source === requested.source &&
    existing.customDescription === requested.customDescription &&
    existing.sourceSessionId === requested.sourceSessionId &&
    (existing.sourceAgreementId ?? null) === requested.sourceAgreementId &&
    (existing.sourceAgreementRevision ?? null) === requested.sourceAgreementRevision &&
    existing.frequency === requested.frequency &&
    existing.deliveryChannel === requested.deliveryChannel &&
    assignmentDueAtMatches(existing.dueAt, requested.dueAt) &&
    existing.therapistNote === requested.therapistNote
  );
}
