import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuditMetadata,
  Client,
  ClientBriefing,
  CreateClientInput,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientInput,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toBriefingSessionSummary, toClient, toConsent } from './client.mappers';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    psychologistId: string,
    dto: CreateClientInput,
    auditMeta: AuditMetadata,
  ): Promise<Client> {
    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.client.create({
        data: {
          psychologistId,
          fullNameEncrypted: dto.fullName,
          contactPhoneEncrypted: dto.contactPhone,
          contactEmailEncrypted: dto.contactEmail ?? null,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          presentingConcerns: dto.presentingConcerns ?? null,
          preferredModality: dto.preferredModality ?? null,
          status: 'ACTIVE',
        },
      });

      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'CLIENT_CREATED',
          targetType: 'Client',
          targetId: row.id,
          metadata: auditMeta,
        },
        tx,
      );

      for (const c of dto.consents) {
        const consentRow = await tx.consent.create({
          data: {
            clientId: row.id,
            psychologistId,
            scope: c.scope,
            status: 'GRANTED',
            scriptVersion: c.scriptVersion,
            capturedVia: c.capturedVia,
            grantedAt: now,
            notes: c.notes ?? null,
          },
        });
        await this.audit.log(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: psychologistId,
            action: 'CONSENT_GRANTED',
            targetType: 'Consent',
            targetId: consentRow.id,
            metadata: { ...auditMeta, scope: c.scope, clientId: row.id },
          },
          tx,
        );
      }

      return row;
    });

    return toClient(created);
  }

  async list(psychologistId: string, query: ListClientsQuery): Promise<ListClientsResponse> {
    const where: Prisma.ClientWhereInput = {
      psychologistId,
      deletedAt: null,
      ...(query.status && { status: query.status }),
    };
    const items = await this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = items.length > query.limit;
    const trimmed = hasMore ? items.slice(0, query.limit) : items;
    return {
      items: trimmed.map(toClient),
      nextCursor: hasMore ? (trimmed[trimmed.length - 1]?.id ?? null) : null,
    };
  }

  async get(psychologistId: string, clientId: string, auditMeta: AuditMetadata): Promise<Client> {
    const row = await this.fetchOwnedClient(psychologistId, clientId);
    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'CLIENT_VIEWED',
      targetType: 'Client',
      targetId: clientId,
      metadata: auditMeta,
    });
    return toClient(row);
  }

  async update(
    psychologistId: string,
    clientId: string,
    dto: UpdateClientInput,
    auditMeta: AuditMetadata,
  ): Promise<Client> {
    const existing = await this.fetchOwnedClient(psychologistId, clientId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.client.update({
        where: { id: clientId },
        data: {
          ...(dto.fullName !== undefined && { fullNameEncrypted: dto.fullName }),
          ...(dto.contactPhone !== undefined && { contactPhoneEncrypted: dto.contactPhone }),
          ...(dto.contactEmail !== undefined && { contactEmailEncrypted: dto.contactEmail }),
          ...(dto.dateOfBirth !== undefined && {
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          }),
          ...(dto.presentingConcerns !== undefined && {
            presentingConcerns: dto.presentingConcerns,
          }),
          ...(dto.preferredModality !== undefined && {
            preferredModality: dto.preferredModality,
          }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
      });
      const before: Record<string, unknown> = {};
      for (const key of Object.keys(dto) as (keyof typeof dto)[]) {
        before[key] = (existing as unknown as Record<string, unknown>)[key];
      }
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'CLIENT_UPDATED',
          targetType: 'Client',
          targetId: clientId,
          metadata: { ...auditMeta, before, after: dto },
        },
        tx,
      );
      return row;
    });
    return toClient(updated);
  }

  async briefing(
    psychologistId: string,
    clientId: string,
    auditMeta: AuditMetadata,
  ): Promise<ClientBriefing> {
    const client = await this.fetchOwnedClient(psychologistId, clientId);
    const [consents, sessions] = await Promise.all([
      this.prisma.consent.findMany({
        where: { clientId },
        orderBy: [{ scope: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.session.findMany({
        where: { clientId },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      }),
    ]);

    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'CLIENT_BRIEFING_VIEWED',
      targetType: 'Client',
      targetId: clientId,
      metadata: auditMeta,
    });

    return {
      client: toClient(client),
      consents: consents.map(toConsent),
      recentSessions: sessions.map(toBriefingSessionSummary),
      lastNote: null,
    };
  }

  private async fetchOwnedClient(psychologistId: string, clientId: string) {
    const row = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!row || row.deletedAt !== null) throw new NotFoundException('Client not found');
    if (row.psychologistId !== psychologistId) {
      // Don't leak existence of cross-tenant rows.
      this.logger.warn(
        `Cross-tenant access attempt: psy=${psychologistId} client=${clientId} (owned by ${row.psychologistId})`,
      );
      throw new NotFoundException('Client not found');
    }
    return row;
  }
}
