import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { AdminAuditQuerySchema } from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/audit — filtered read over the append-only audit log.
 * Admin-gated. Filters: action, actorPsychologistId, targetType, targetId,
 * since (ISO). Capped at 200 rows, newest first. Reading the audit log is
 * itself an auditable event — each query writes one `ADMIN_AUDIT_LOG_READ`
 * row carrying the filter used (never the returned rows).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const q = parseQuery(req.url, AdminAuditQuerySchema);
  if (!q.ok) return q.response;
  const { action, actorPsychologistId, targetType, targetId, since, limit } = q.value;

  const where: Prisma.AuditLogWhereInput = {};
  if (action) where.action = action;
  if (actorPsychologistId) where.actorPsychologistId = actorPsychologistId;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (since) where.createdAt = { gte: new Date(since) };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      actorType: true,
      actorPsychologistId: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
    },
  });

  // Resolve actor emails for display (batch; admins only — no client PII).
  const actorIds = [
    ...new Set(rows.map((r) => r.actorPsychologistId).filter((x): x is string => x !== null)),
  ];
  const actors = actorIds.length
    ? await prisma.psychologist.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true },
      })
    : [];
  const emailById = new Map(actors.map((a) => [a.id, a.email]));

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'ADMIN_AUDIT_LOG_READ',
    targetType: 'AuditLog',
    targetId: 'query',
    metadata: {
      ...auditMetadataFromRequest(req),
      filter: {
        action: action ?? null,
        actorPsychologistId: actorPsychologistId ?? null,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        since: since ?? null,
      },
      returned: rows.length,
    },
  });

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorType: r.actorType,
      actorPsychologistId: r.actorPsychologistId,
      actorEmail: r.actorPsychologistId ? (emailById.get(r.actorPsychologistId) ?? null) : null,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
