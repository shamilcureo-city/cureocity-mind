import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AuditMetadata,
  DsrConsentWithdrawalInput,
  DsrCorrectionInput,
  DsrDataExport,
  DsrErasure,
  DsrErasureInput,
  DsrGrievance,
  DsrGrievanceInput,
  DsrNomination,
  DsrNominationInput,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * DsrService — Sprint 9 PR 2.
 *
 * Implements the six rights from the DPDP Act:
 *   exportData()          § 11 access
 *   requestCorrection()   § 12 correction
 *   recordNomination()    § 13 nomination
 *   withdrawConsent()     § 13 withdraw consent
 *   fileGrievance()       § 14 grievance
 *   requestErasure()      § 15 erasure
 *
 * Every entry point writes an audit row with action prefixed DSR_*.
 * The "request" rights (correction, erasure) record intent — fulfilment
 * is done by an admin via Sprint 9 PR 1's admin surface in a separate
 * code path; this lets us preserve the DPDP requirement that the data
 * fiduciary respond within 30 days while still letting clinicians
 * review e.g. an erasure request for ongoing-care implications.
 */
@Injectable()
export class DsrService {
  private readonly logger = new Logger(DsrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async exportData(clientId: string, auditMeta: AuditMetadata): Promise<DsrDataExport> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        psychologist: { select: { id: true, fullName: true, email: true } },
        consents: {
          orderBy: { grantedAt: 'desc' },
          select: {
            scope: true,
            status: true,
            scriptVersion: true,
            grantedAt: true,
            withdrawnAt: true,
          },
        },
        nominations: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            nomineeName: true,
            nomineeRelation: true,
            createdAt: true,
            supersededAt: true,
          },
        },
        erasureRequests: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, createdAt: true, resolvedAt: true },
        },
        grievances: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            subject: true,
            status: true,
            createdAt: true,
            resolvedAt: true,
          },
        },
      },
    });
    if (!client) throw new NotFoundException('Client not found');

    const [sessionCount, moodLogCount, journalEntryCount, exerciseAssignmentCount] =
      await Promise.all([
        this.prisma.session.count({ where: { clientId } }),
        this.prisma.moodLog.count({ where: { clientId } }),
        this.prisma.journalEntry.count({ where: { clientId } }),
        this.prisma.exerciseAssignment.count({ where: { clientId } }),
      ]);

    const exportedAt = new Date().toISOString();

    await this.audit.log({
      actorType: 'CLIENT',
      action: 'DSR_ACCESS_FULFILLED',
      targetType: 'Client',
      targetId: clientId,
      metadata: {
        ...auditMeta,
        sessionCount,
        moodLogCount,
        journalEntryCount,
        exerciseAssignmentCount,
      },
    });

    return {
      exportedAt,
      client: {
        id: client.id,
        fullName: client.fullNameEncrypted ?? '',
        contactPhone: client.contactPhoneEncrypted ?? '',
        contactEmail: client.contactEmailEncrypted,
        dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
        presentingConcerns: client.presentingConcerns,
        preferredModality: client.preferredModality,
        status: client.status,
        createdAt: client.createdAt.toISOString(),
      },
      psychologist: {
        id: client.psychologist.id,
        fullName: client.psychologist.fullName,
        email: client.psychologist.email,
      },
      consents: client.consents.map((c) => ({
        scope: c.scope,
        status: c.status,
        scriptVersion: c.scriptVersion,
        grantedAt: c.grantedAt.toISOString(),
        withdrawnAt: c.withdrawnAt ? c.withdrawnAt.toISOString() : null,
      })),
      sessionCount,
      moodLogCount,
      journalEntryCount,
      exerciseAssignmentCount,
      nominations: client.nominations.map((n) => ({
        id: n.id,
        nomineeName: n.nomineeName,
        nomineeRelation: n.nomineeRelation,
        createdAt: n.createdAt.toISOString(),
        supersededAt: n.supersededAt ? n.supersededAt.toISOString() : null,
      })),
      erasureRequests: client.erasureRequests.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      })),
      grievances: client.grievances.map((g) => ({
        id: g.id,
        subject: g.subject,
        status: g.status,
        createdAt: g.createdAt.toISOString(),
        resolvedAt: g.resolvedAt ? g.resolvedAt.toISOString() : null,
      })),
    };
  }

  async requestCorrection(
    clientId: string,
    dto: DsrCorrectionInput,
    auditMeta: AuditMetadata,
  ): Promise<void> {
    const existing = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        fullNameEncrypted: true,
        contactPhoneEncrypted: true,
        contactEmailEncrypted: true,
      },
    });
    if (!existing) throw new NotFoundException('Client not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: clientId },
        data: {
          ...(dto.fullName !== undefined && { fullNameEncrypted: dto.fullName }),
          ...(dto.contactPhone !== undefined && { contactPhoneEncrypted: dto.contactPhone }),
          ...(dto.contactEmail !== undefined && { contactEmailEncrypted: dto.contactEmail }),
        },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'DSR_CORRECTION_REQUESTED',
          targetType: 'Client',
          targetId: clientId,
          metadata: {
            ...auditMeta,
            before: existing,
            after: {
              fullNameEncrypted: dto.fullName ?? existing.fullNameEncrypted,
              contactPhoneEncrypted: dto.contactPhone ?? existing.contactPhoneEncrypted,
              contactEmailEncrypted:
                dto.contactEmail === undefined ? existing.contactEmailEncrypted : dto.contactEmail,
            },
            reason: dto.reason,
          },
        },
        tx,
      );
    });
  }

  async recordNomination(
    clientId: string,
    dto: DsrNominationInput,
    auditMeta: AuditMetadata,
  ): Promise<DsrNomination> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Supersede any prior unrevoked nomination — only one is "active" at a time.
      await tx.clientNomination.updateMany({
        where: { clientId, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      const created = await tx.clientNomination.create({
        data: {
          clientId,
          nomineeName: dto.nomineeName,
          nomineeRelation: dto.nomineeRelation,
          nomineePhone: dto.nomineePhone,
          nomineeEmail: dto.nomineeEmail ?? null,
          notes: dto.notes ?? null,
        },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'DSR_NOMINATION_RECORDED',
          targetType: 'ClientNomination',
          targetId: created.id,
          metadata: { ...auditMeta, clientId, nomineeRelation: dto.nomineeRelation },
        },
        tx,
      );
      return created;
    });

    return {
      id: row.id,
      nomineeName: row.nomineeName,
      nomineeRelation: row.nomineeRelation,
      nomineePhone: row.nomineePhone,
      nomineeEmail: row.nomineeEmail,
      notes: row.notes,
      supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async withdrawConsent(
    clientId: string,
    dto: DsrConsentWithdrawalInput,
    auditMeta: AuditMetadata,
  ): Promise<void> {
    const active = await this.prisma.consent.findFirst({
      where: { clientId, scope: dto.scope, status: 'GRANTED' },
      orderBy: { grantedAt: 'desc' },
    });
    if (!active) {
      throw new BadRequestException(
        `No active consent for scope ${dto.scope} — nothing to withdraw`,
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.consent.update({
        where: { id: active.id },
        data: { status: 'WITHDRAWN', withdrawnAt: now },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'DSR_CONSENT_WITHDRAWN',
          targetType: 'Consent',
          targetId: active.id,
          metadata: {
            ...auditMeta,
            clientId,
            scope: dto.scope,
            ...(dto.reason !== undefined && { reason: dto.reason }),
          },
        },
        tx,
      );
      // Also write the standard CONSENT_WITHDRAWN row so existing
      // briefing + retention paths see the change.
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'CONSENT_WITHDRAWN',
          targetType: 'Consent',
          targetId: active.id,
          metadata: { ...auditMeta, clientId, scope: dto.scope, viaDsr: true },
        },
        tx,
      );
    });
  }

  async fileGrievance(
    clientId: string,
    dto: DsrGrievanceInput,
    auditMeta: AuditMetadata,
  ): Promise<DsrGrievance> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clientGrievance.create({
        data: { clientId, subject: dto.subject, body: dto.body },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'DSR_GRIEVANCE_FILED',
          targetType: 'ClientGrievance',
          targetId: created.id,
          metadata: {
            ...auditMeta,
            clientId,
            subjectLength: dto.subject.length,
            bodyLength: dto.body.length,
          },
        },
        tx,
      );
      return created;
    });

    return {
      id: row.id,
      subject: row.subject,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    };
  }

  async requestErasure(
    clientId: string,
    dto: DsrErasureInput,
    auditMeta: AuditMetadata,
  ): Promise<DsrErasure> {
    // Block duplicate open requests so the admin queue doesn't fill
    // with the same client over and over.
    const open = await this.prisma.clientErasureRequest.findFirst({
      where: { clientId, status: { in: ['PENDING', 'APPROVED'] } },
    });
    if (open) {
      throw new BadRequestException(
        `An erasure request is already in flight (id=${open.id}, status=${open.status})`,
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clientErasureRequest.create({
        data: { clientId, reason: dto.reason ?? null },
      });
      await this.audit.log(
        {
          actorType: 'CLIENT',
          action: 'DSR_ERASURE_REQUESTED',
          targetType: 'ClientErasureRequest',
          targetId: created.id,
          metadata: { ...auditMeta, clientId, hasReason: dto.reason !== undefined },
        },
        tx,
      );
      return created;
    });

    return {
      id: row.id,
      status: row.status,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      resolutionNotes: row.resolutionNotes,
    };
  }
}
