import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AuditMetadata,
  CreateSessionInput,
  NoteDraft,
  Session,
  SessionConsentAckInput,
  SessionConsentSnapshot,
  SignNoteInput,
  TherapyNote,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotesService } from '../notes/notes.service';
import { SignService } from '../notes/sign.service';
import { toSession } from './session.mappers';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notes: NotesService,
    private readonly signer: SignService,
  ) {}

  async create(
    psychologistId: string,
    dto: CreateSessionInput,
    auditMeta: AuditMetadata,
  ): Promise<Session> {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client || client.deletedAt !== null) {
      throw new NotFoundException('Client not found');
    }
    if (client.psychologistId !== psychologistId) {
      this.logger.warn(
        `Cross-tenant session create: psy=${psychologistId} client=${dto.clientId} (owned by ${client.psychologistId})`,
      );
      throw new NotFoundException('Client not found');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.session.create({
        data: {
          clientId: dto.clientId,
          psychologistId,
          modality: dto.modality,
          status: 'SCHEDULED',
          scheduledAt: new Date(dto.scheduledAt),
        },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'SESSION_CREATED',
          targetType: 'Session',
          targetId: row.id,
          metadata: { ...auditMeta, clientId: dto.clientId, modality: dto.modality },
        },
        tx,
      );
      return row;
    });
    return toSession(created);
  }

  async get(
    psychologistId: string,
    sessionId: string,
    _auditMeta: AuditMetadata,
  ): Promise<Session> {
    const row = await this.fetchOwnedSession(psychologistId, sessionId);
    return toSession(row);
  }

  async recordConsent(
    psychologistId: string,
    sessionId: string,
    dto: SessionConsentAckInput,
    auditMeta: AuditMetadata,
  ): Promise<Session> {
    const existing = await this.fetchOwnedSession(psychologistId, sessionId);
    if (existing.status !== 'SCHEDULED') {
      throw new BadRequestException(
        `Cannot record consent on a session in ${existing.status} state`,
      );
    }

    const ackedAt = new Date().toISOString();
    const snapshot: SessionConsentSnapshot = {
      entries: dto.scopes.map((scope) => ({
        scope,
        scriptVersion: dto.scriptVersion,
        ackedAt,
      })),
      notes: dto.notes ?? null,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.session.update({
        where: { id: sessionId },
        data: { consentSnapshot: snapshot },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'SESSION_CONSENT_RECORDED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: {
            ...auditMeta,
            scopes: dto.scopes,
            scriptVersion: dto.scriptVersion,
          },
        },
        tx,
      );
      return row;
    });
    return toSession(updated);
  }

  async start(
    psychologistId: string,
    sessionId: string,
    auditMeta: AuditMetadata,
  ): Promise<Session> {
    const existing = await this.fetchOwnedSession(psychologistId, sessionId);
    if (existing.status !== 'SCHEDULED') {
      throw new BadRequestException(`Cannot start a session in ${existing.status} state`);
    }
    if (existing.consentSnapshot === null) {
      throw new BadRequestException(
        'Session consent must be recorded before starting (POST /sessions/:id/consent)',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.session.update({
        where: { id: sessionId },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'SESSION_STARTED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: auditMeta,
        },
        tx,
      );
      return row;
    });
    return toSession(updated);
  }

  async end(psychologistId: string, sessionId: string, auditMeta: AuditMetadata): Promise<Session> {
    const existing = await this.fetchOwnedSession(psychologistId, sessionId);
    if (existing.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`Cannot end a session in ${existing.status} state`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.session.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'SESSION_ENDED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: auditMeta,
        },
        tx,
      );
      return row;
    });

    // Trigger note-generation pipeline. Errors here are non-fatal — the
    // session is still marked COMPLETED and the worker can be re-kicked.
    try {
      await this.notes.enqueueGeneration(sessionId);
    } catch (e) {
      this.logger.error(
        `Failed to enqueue note generation for session=${sessionId}: ${(e as Error).message}`,
      );
    }
    return toSession(updated);
  }

  async getNoteDraft(
    psychologistId: string,
    sessionId: string,
    auditMeta: AuditMetadata,
  ): Promise<NoteDraft> {
    return this.notes.getDraftForSession(psychologistId, sessionId, auditMeta);
  }

  async signNote(
    psychologistId: string,
    sessionId: string,
    input: SignNoteInput,
    auditMeta: AuditMetadata,
  ): Promise<TherapyNote> {
    return this.signer.sign(psychologistId, sessionId, input, auditMeta);
  }

  async getTherapyNote(psychologistId: string, sessionId: string): Promise<TherapyNote | null> {
    return this.signer.getTherapyNote(psychologistId, sessionId);
  }

  private async fetchOwnedSession(psychologistId: string, sessionId: string) {
    const row = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!row) throw new NotFoundException('Session not found');
    if (row.psychologistId !== psychologistId) {
      this.logger.warn(
        `Cross-tenant session access: psy=${psychologistId} session=${sessionId} (owned by ${row.psychologistId})`,
      );
      throw new NotFoundException('Session not found');
    }
    return row;
  }
}
