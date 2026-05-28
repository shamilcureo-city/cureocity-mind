import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuditLogEntry,
  AuditLogPage,
  AuditLogQuery,
  AuditMetadata,
} from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * AdminService — Sprint 9 PR 1.
 *
 * Surfaces the audit log to an authenticated ADMIN psychologist with
 * composable filters and cursor pagination. Every successful query
 * writes an ADMIN_AUDIT_LOG_READ row containing the filter parameters
 * so the activity of admins is itself reviewable
 * (audit-of-the-audit). The recursion stops there — reading audit-of-
 * the-audit rows does NOT generate a new audit row, otherwise a single
 * read would N+1 the table.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listAuditLogs(
    actorPsychologistId: string,
    query: AuditLogQuery,
    auditMeta: AuditMetadata,
  ): Promise<AuditLogPage> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.from && { createdAt: { gte: new Date(query.from) } }),
      ...(query.to && {
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          lt: new Date(query.to),
        },
      }),
      ...(query.action && { action: query.action }),
      ...(query.actorPsychologistId && { actorPsychologistId: query.actorPsychologistId }),
      ...(query.targetType && { targetType: query.targetType }),
      ...(query.targetId && { targetId: query.targetId }),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    // Audit-of-the-audit. Capture the filters so a regulator can see
    // what the admin actually queried. Skip when the action filter is
    // ADMIN_AUDIT_LOG_READ itself — otherwise paging through the
    // audit-of-the-audit table generates fresh audit-of-the-audit rows.
    if (query.action !== 'ADMIN_AUDIT_LOG_READ') {
      await this.audit.log({
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId,
        action: 'ADMIN_AUDIT_LOG_READ',
        targetType: 'AuditLog',
        targetId: 'query',
        metadata: {
          ...auditMeta,
          filters: {
            ...(query.from && { from: query.from }),
            ...(query.to && { to: query.to }),
            ...(query.action && { action: query.action }),
            ...(query.actorPsychologistId && { actorPsychologistId: query.actorPsychologistId }),
            ...(query.targetType && { targetType: query.targetType }),
            ...(query.targetId && { targetId: query.targetId }),
            limit: query.limit,
          },
          returnedCount: items.length,
        },
      });
    }

    return {
      items: items.map(toAuditLogEntry),
      nextCursor,
    };
  }

  async grantAdmin(
    actorPsychologistId: string,
    targetPsychologistId: string,
    auditMeta: AuditMetadata,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.psychologist.update({
        where: { id: targetPsychologistId },
        data: { role: 'ADMIN' },
        select: { id: true, role: true },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId,
          action: 'ADMIN_ROLE_GRANTED',
          targetType: 'Psychologist',
          targetId: updated.id,
          metadata: { ...auditMeta, newRole: 'ADMIN' },
        },
        tx,
      );
    });
    this.logger.warn(
      `Admin role GRANTED to psy=${targetPsychologistId} by admin=${actorPsychologistId}`,
    );
  }

  async revokeAdmin(
    actorPsychologistId: string,
    targetPsychologistId: string,
    auditMeta: AuditMetadata,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.psychologist.update({
        where: { id: targetPsychologistId },
        data: { role: 'THERAPIST' },
        select: { id: true, role: true },
      });
      await this.audit.log(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId,
          action: 'ADMIN_ROLE_REVOKED',
          targetType: 'Psychologist',
          targetId: updated.id,
          metadata: { ...auditMeta, newRole: 'THERAPIST' },
        },
        tx,
      );
    });
    this.logger.warn(
      `Admin role REVOKED from psy=${targetPsychologistId} by admin=${actorPsychologistId}`,
    );
  }
}

function toAuditLogEntry(row: {
  id: string;
  actorType: 'PSYCHOLOGIST' | 'SYSTEM' | 'CLIENT';
  actorPsychologistId: string | null;
  action: AuditLogEntry['action'];
  targetType: string;
  targetId: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}): AuditLogEntry {
  return {
    id: row.id,
    actorType: row.actorType,
    actorPsychologistId: row.actorPsychologistId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata:
      row.metadata === null || typeof row.metadata !== 'object'
        ? null
        : (row.metadata as AuditLogEntry['metadata']),
    createdAt: row.createdAt.toISOString(),
  };
}
