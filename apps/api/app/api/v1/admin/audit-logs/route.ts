import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { AuditLogQuerySchema, type AuditLogEntry, type AuditLogPage } from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toEntry(row: {
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

/**
 * GET /api/v1/admin/audit-logs — composable filter + cursor paging.
 * Every successful query writes ADMIN_AUDIT_LOG_READ — except when
 * querying for ADMIN_AUDIT_LOG_READ itself (would N+1 the table).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const q = parseQuery(req.url, AuditLogQuerySchema);
  if (!q.ok) return q.response;
  const query = q.value;

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

  const limit = query.limit ?? 100;
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

  if (query.action !== 'ADMIN_AUDIT_LOG_READ') {
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'ADMIN_AUDIT_LOG_READ',
      targetType: 'AuditLog',
      targetId: 'query',
      metadata: {
        ...auditMetadataFromRequest(req),
        filters: {
          ...(query.from && { from: query.from }),
          ...(query.to && { to: query.to }),
          ...(query.action && { action: query.action }),
          ...(query.actorPsychologistId && { actorPsychologistId: query.actorPsychologistId }),
          ...(query.targetType && { targetType: query.targetType }),
          ...(query.targetId && { targetId: query.targetId }),
          limit,
        },
        returnedCount: items.length,
      },
    });
  }

  const body: AuditLogPage = { items: items.map(toEntry), nextCursor };
  return NextResponse.json(body);
}
