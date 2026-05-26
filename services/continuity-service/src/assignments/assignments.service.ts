import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
    if (!KNOWN_EXERCISE_IDS.has(dto.exerciseId)) {
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

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.exerciseAssignment.create({
        data: {
          clientId: dto.clientId,
          psychologistId,
          exerciseId: dto.exerciseId,
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

export function toExerciseAssignment(row: {
  id: string;
  clientId: string;
  psychologistId: string;
  exerciseId: string;
  assignedAt: Date;
  dueAt: Date | null;
  status: ExerciseAssignment['status'];
  completedAt: Date | null;
  response: Prisma.JsonValue;
  therapistNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ExerciseAssignment {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    exerciseId: row.exerciseId,
    assignedAt: row.assignedAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    response: row.response === null ? null : (row.response as Record<string, unknown>),
    therapistNote: row.therapistNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
