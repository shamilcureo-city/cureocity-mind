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
  PushSubscriptionRecord,
  RecordCompletionInput,
  RegisterPushSubscriptionInput,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../encryption/encryption.service';
import { toExerciseAssignment } from '../assignments/assignments.service';

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  async listExercises(clientId: string): Promise<ExerciseAssignment[]> {
    const rows = await this.prisma.exerciseAssignment.findMany({
      where: { clientId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: [{ dueAt: 'asc' }, { assignedAt: 'asc' }],
    });
    return rows.map(toExerciseAssignment);
  }

  async getExercise(clientId: string, assignmentId: string): Promise<ExerciseAssignment> {
    const row = await this.prisma.exerciseAssignment.findUnique({ where: { id: assignmentId } });
    if (!row || row.clientId !== clientId) {
      throw new NotFoundException('Assignment not found');
    }
    return toExerciseAssignment(row);
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
    // Resolve the owning psychologist so we encrypt against the right
    // tenant key. Encryption happens outside the tx since the DEK
    // resolution may hit KMS; the tx still wraps the write.
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { psychologistId: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    let contentEncrypted: string | null = null;
    try {
      contentEncrypted = await this.encryption.encryptForTenant(client.psychologistId, dto.content);
    } catch (e) {
      // Don't fail the journal write because the KMS path is unhealthy
      // — the plaintext column is still authoritative during the
      // transition window. Log loudly so the regression is visible.
      this.logger.error(
        `Encryption failed for journal entry; falling back to plaintext-only: ${(e as Error).message}`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.journalEntry.create({
        data: {
          clientId,
          content: dto.content,
          contentEncrypted,
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
            encrypted: contentEncrypted !== null,
          },
        },
        tx,
      );
      return row;
    });
    return toJournalEntry(created);
  }

  async registerPushSubscription(
    clientId: string,
    dto: RegisterPushSubscriptionInput,
    auditMeta: AuditMetadata,
  ): Promise<PushSubscriptionRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Upsert by endpoint: re-subscribing on the same endpoint
      // rotates keys + clears any prior revoke.
      const upserted = await tx.clientPushSubscription.upsert({
        where: { endpoint: dto.endpoint },
        create: {
          clientId,
          endpoint: dto.endpoint,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          userAgent: dto.userAgent ?? null,
        },
        update: {
          clientId,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          userAgent: dto.userAgent ?? null,
          revokedAt: null,
        },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'PUSH_SUBSCRIPTION_REGISTERED',
          targetType: 'ClientPushSubscription',
          targetId: upserted.id,
          metadata: {
            ...auditMeta,
            clientId,
            ...(dto.userAgent !== undefined && { userAgent: dto.userAgent }),
          },
        },
        tx,
      );
      return upserted;
    });

    return {
      id: row.id,
      endpoint: row.endpoint,
      userAgent: row.userAgent,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async revokePushSubscription(
    clientId: string,
    subscriptionId: string,
    auditMeta: AuditMetadata,
  ): Promise<void> {
    const row = await this.prisma.clientPushSubscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, clientId: true },
    });
    if (!row || row.clientId !== clientId) {
      throw new NotFoundException('Subscription not found');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.clientPushSubscription.update({
        where: { id: subscriptionId },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'PUSH_SUBSCRIPTION_REVOKED',
          targetType: 'ClientPushSubscription',
          targetId: subscriptionId,
          metadata: { ...auditMeta, clientId },
        },
        tx,
      );
    });
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
  // We intentionally return the plaintext column today — the encrypted
  // companion is the source of truth for retention guarantees but the
  // service layer's outbound shape stays unchanged so the client PWA
  // doesn't need an in-page decrypt path. When Sprint 10 drops the
  // plaintext column this mapper switches to decrypt-on-read.
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
