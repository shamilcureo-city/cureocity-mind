import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuditMetadata,
  CreateExerciseAssignmentInput,
  ExerciseAssignment,
} from '@cureocity/contracts';
import { CBT_EXERCISE_CATALOG, EMDR_EXERCISE_CATALOG } from '@cureocity/clinical';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const KNOWN_EXERCISE_IDS = new Set<string>([
  ...CBT_EXERCISE_CATALOG.map((e) => e.id),
  ...EMDR_EXERCISE_CATALOG.map((e) => e.id),
]);

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assign(
    psychologistId: string,
    dto: CreateExerciseAssignmentInput,
    auditMeta: AuditMetadata,
  ): Promise<ExerciseAssignment> {
    if (dto.exerciseId && !KNOWN_EXERCISE_IDS.has(dto.exerciseId)) {
      throw new BadRequestException(`Unknown exercise id "${dto.exerciseId}"`);
    }

    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client || client.deletedAt !== null) {
      throw new NotFoundException('Client not found');
    }
    if (client.psychologistId !== psychologistId) {
      this.logger.warn(`Cross-tenant assign: psy=${psychologistId} client=${dto.clientId}`);
      throw new NotFoundException('Client not found');
    }

    if (dto.sourceSessionId) {
      const sourceSession = await this.prisma.session.findFirst({
        where: {
          id: dto.sourceSessionId,
          clientId: dto.clientId,
          psychologistId,
        },
        select: { id: true },
      });
      if (!sourceSession) throw new NotFoundException('Session not found');
    }

    const created = await this.prisma.$transaction(async (tx) => {
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
        WHERE "id" = ${dto.clientId}
        FOR UPDATE
      `;
      const lockedClient = lockedClients[0];
      if (
        !lockedClient ||
        lockedClient.deletedAt !== null ||
        lockedClient.status !== 'ACTIVE' ||
        lockedClient.psychologistId !== psychologistId
      ) {
        throw new NotFoundException('Client not found');
      }

      if (dto.sourceSessionId) {
        const lockedSourceSessions = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "sessions"
          WHERE "id" = ${dto.sourceSessionId}
            AND "clientId" = ${dto.clientId}
            AND "psychologistId" = ${psychologistId}
          FOR UPDATE
        `;
        if (!lockedSourceSessions[0]) throw new NotFoundException('Session not found');
      }

      if (dto.idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.idempotencyKey}))`;
        const existing = await tx.exerciseAssignment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          if (
            !assignmentPayloadMatches(existing, normalizedAssignmentPayload(dto, psychologistId))
          ) {
            throw new ConflictException('Assignment idempotency key was used for another payload');
          }
          return existing;
        }
      }
      const row = await tx.exerciseAssignment.create({
        data: {
          clientId: dto.clientId,
          psychologistId,
          exerciseId: dto.exerciseId ?? null,
          source: dto.task ? 'CUSTOM' : 'CATALOG',
          customDescription: dto.task ?? null,
          sourceSessionId: dto.sourceSessionId ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          frequency: dto.frequency ?? null,
          deliveryChannel: dto.deliveryChannel ?? null,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          therapistNote: dto.therapistNote ?? null,
          status: 'PENDING',
        },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'EXERCISE_ASSIGNED',
          targetType: 'ExerciseAssignment',
          targetId: row.id,
          metadata: {
            ...auditMeta,
            clientId: dto.clientId,
            exerciseId: dto.exerciseId,
            dueAt: dto.dueAt ?? null,
          },
        },
        tx,
      );
      return row;
    });
    return toExerciseAssignment(created);
  }

  async listForClient(psychologistId: string, clientId: string): Promise<ExerciseAssignment[]> {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.deletedAt !== null) throw new NotFoundException('Client not found');
    if (client.psychologistId !== psychologistId) {
      throw new NotFoundException('Client not found');
    }
    const rows = await this.prisma.exerciseAssignment.findMany({
      where: { clientId },
      orderBy: { assignedAt: 'desc' },
    });
    return rows.map(toExerciseAssignment);
  }
}

function normalizedAssignmentPayload(dto: CreateExerciseAssignmentInput, psychologistId: string) {
  return {
    psychologistId,
    clientId: dto.clientId,
    exerciseId: dto.exerciseId ?? null,
    source: dto.task ? 'CUSTOM' : 'CATALOG',
    customDescription: dto.task ?? null,
    sourceSessionId: dto.sourceSessionId ?? null,
    frequency: dto.frequency ?? null,
    deliveryChannel: dto.deliveryChannel ?? null,
    dueAt: dto.dueAt ? new Date(dto.dueAt).toISOString() : null,
    therapistNote: dto.therapistNote ?? null,
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
    frequency: string | null;
    deliveryChannel: string | null;
    dueAt: Date | null;
    therapistNote: string | null;
  },
  requested: ReturnType<typeof normalizedAssignmentPayload>,
): boolean {
  return (
    existing.psychologistId === requested.psychologistId &&
    existing.clientId === requested.clientId &&
    existing.exerciseId === requested.exerciseId &&
    existing.source === requested.source &&
    existing.customDescription === requested.customDescription &&
    existing.sourceSessionId === requested.sourceSessionId &&
    existing.frequency === requested.frequency &&
    existing.deliveryChannel === requested.deliveryChannel &&
    (existing.dueAt?.toISOString() ?? null) === requested.dueAt &&
    existing.therapistNote === requested.therapistNote
  );
}

export function toExerciseAssignment(row: {
  id: string;
  clientId: string;
  psychologistId: string;
  // Sprint 51 — nullable; therapy-script rows leave this null and use
  // customDescription + a CATALOG/THERAPY_SCRIPT source provenance.
  exerciseId: string | null;
  source: ExerciseAssignment['source'];
  customDescription: string | null;
  sourceTherapyScriptId: string | null;
  sourceSessionId: string | null;
  assignedAt: Date;
  dueAt: Date | null;
  frequency: string | null;
  deliveryChannel: ExerciseAssignment['deliveryChannel'];
  status: ExerciseAssignment['status'];
  completedAt: Date | null;
  response: Prisma.JsonValue;
  respondedAt: Date | null;
  responseShareId: string | null;
  responseShareBatchId: string | null;
  therapistNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ExerciseAssignment {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    exerciseId: row.exerciseId,
    source: row.source,
    customDescription: row.customDescription,
    sourceTherapyScriptId: row.sourceTherapyScriptId,
    sourceSessionId: row.sourceSessionId,
    assignedAt: row.assignedAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    frequency: row.frequency,
    deliveryChannel: row.deliveryChannel,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    response: row.response === null ? null : (row.response as Record<string, unknown>),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseShareId: row.responseShareId,
    responseShareBatchId: row.responseShareBatchId,
    therapistNote: row.therapistNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
