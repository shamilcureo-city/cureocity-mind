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
  CreateJournalEntryInput,
  CreateMoodLogInput,
  ExerciseAssignment,
  JournalEntry,
  MoodLog,
  NextSessionSummary,
  RecordCompletionInput,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toExerciseAssignment } from '../assignments/assignments.service';

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listExercises(clientId: string): Promise<ExerciseAssignment[]> {
    const rows = await this.prisma.exerciseAssignment.findMany({
      where: { clientId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: [{ dueAt: 'asc' }, { assignedAt: 'asc' }],
    });
    return rows.map(toExerciseAssignment);
  }

  async recordCompletion(
    clientId: string,
    assignmentId: string,
    dto: RecordCompletionInput,
    auditMeta: AuditMetadata,
  ): Promise<ExerciseAssignment> {
    const existing = await this.prisma.exerciseAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!existing || existing.clientId !== clientId) {
      throw new NotFoundException('Assignment not found');
    }
    if (existing.status === 'COMPLETED') {
      throw new ConflictException('Assignment already completed');
    }
    if (existing.status === 'SKIPPED' || existing.status === 'EXPIRED') {
      throw new BadRequestException(`Cannot complete an assignment in ${existing.status} state`);
    }

    const responseWithNotes: Record<string, unknown> = { ...dto.response };
    if (dto.notes !== undefined) responseWithNotes['notes'] = dto.notes;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.exerciseAssignment.update({
        where: { id: assignmentId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          response: responseWithNotes as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'EXERCISE_COMPLETION_RECORDED',
          targetType: 'ExerciseAssignment',
          targetId: assignmentId,
          metadata: { ...auditMeta, clientId, exerciseId: existing.exerciseId },
        },
        tx,
      );
      return row;
    });
    return toExerciseAssignment(updated);
  }

  async logMood(
    clientId: string,
    dto: CreateMoodLogInput,
    auditMeta: AuditMetadata,
  ): Promise<MoodLog> {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.moodLog.create({
        data: {
          clientId,
          rating: dto.rating,
          notes: dto.notes ?? null,
          recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'MOOD_LOGGED',
          targetType: 'MoodLog',
          targetId: row.id,
          metadata: { ...auditMeta, clientId, rating: dto.rating },
        },
        tx,
      );
      return row;
    });
    return toMoodLog(created);
  }

  async listMoods(clientId: string, limit = 100): Promise<MoodLog[]> {
    const rows = await this.prisma.moodLog.findMany({
      where: { clientId },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(limit, 365),
    });
    return rows.map(toMoodLog);
  }

  async createJournal(
    clientId: string,
    dto: CreateJournalEntryInput,
    auditMeta: AuditMetadata,
  ): Promise<JournalEntry> {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.journalEntry.create({
        data: {
          clientId,
          content: dto.content,
          mood: dto.mood ?? null,
          sharedWithTherapist: dto.sharedWithTherapist ?? false,
          recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'JOURNAL_ENTRY_CREATED',
          targetType: 'JournalEntry',
          targetId: row.id,
          metadata: {
            ...auditMeta,
            clientId,
            contentLength: dto.content.length,
            hasMood: dto.mood !== undefined,
            sharedWithTherapist: dto.sharedWithTherapist ?? false,
          },
        },
        tx,
      );
      return row;
    });
    return toJournalEntry(created);
  }

  async getNextSession(clientId: string): Promise<NextSessionSummary | null> {
    const now = new Date();
    const row = await this.prisma.session.findFirst({
      where: {
        clientId,
        status: 'SCHEDULED',
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      include: { psychologist: { select: { fullName: true } } },
    });
    if (!row) return null;
    return {
      sessionId: row.id,
      scheduledAt: row.scheduledAt.toISOString(),
      modality: row.modality,
      psychologistFullName: row.psychologist.fullName,
    };
  }

  async listJournals(clientId: string, limit = 50): Promise<JournalEntry[]> {
    const rows = await this.prisma.journalEntry.findMany({
      where: { clientId },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map(toJournalEntry);
  }
}

function toMoodLog(row: {
  id: string;
  clientId: string;
  rating: number;
  notes: string | null;
  recordedAt: Date;
  createdAt: Date;
}): MoodLog {
  return {
    id: row.id,
    clientId: row.clientId,
    rating: row.rating,
    notes: row.notes,
    recordedAt: row.recordedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toJournalEntry(row: {
  id: string;
  clientId: string;
  content: string;
  mood: number | null;
  sharedWithTherapist: boolean;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): JournalEntry {
  return {
    id: row.id,
    clientId: row.clientId,
    content: row.content,
    mood: row.mood,
    sharedWithTherapist: row.sharedWithTherapist,
    recordedAt: row.recordedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
