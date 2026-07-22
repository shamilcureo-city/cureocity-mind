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
 * PC2 review fix — metadata redaction at the exposure boundary.
 *
 * Audit rows are cross-tenant and SOME writers persist client clinical
 * content in metadata (e.g. CRISIS_FLAG_RAISED stores the risk `details` +
 * `indicators`; NOTE_DRAFT_VIEWED stores the therapist's free-text
 * `instruction`; DIAGNOSIS_CONFIRMED stores `icd11Code` + `clientId`). The
 * super-admin manages accounts, NOT client PHI — so this route NEVER returns
 * raw metadata. Only these structurally-safe keys are surfaced (request
 * meta, audit-read meta, and account-op fields that carry ids/enums/counts):
 */
const GLOBAL_SAFE_META_KEYS = new Set([
  'ip',
  'userAgent',
  'requestId',
  'filter',
  'returned',
  'targetEmail',
  'wasInvited',
  'op',
  'source',
  'version',
]);
// `before`/`after` are only meaningful — and only known-safe (enum/number
// transitions) — for the account-lifecycle actions this console owns. For any
// other action they could carry content, so they pass through ONLY for these.
const BEFORE_AFTER_ACTIONS = new Set([
  'ADMIN_ROLE_GRANTED',
  'ADMIN_ROLE_REVOKED',
  'ADMIN_ACCOUNT_STATUS_CHANGED',
  'ADMIN_TRIAL_CAP_ADJUSTED',
]);

function redactMeta(action: string, metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const src = metadata as Record<string, unknown>;
  const allow = new Set(GLOBAL_SAFE_META_KEYS);
  if (BEFORE_AFTER_ACTIONS.has(action)) {
    allow.add('before');
    allow.add('after');
  }
  const out: Record<string, unknown> = {};
  for (const k of allow) if (k in src) out[k] = src[k];
  return Object.keys(out).length > 0 ? out : null;
}

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
      metadata: redactMeta(r.action, r.metadata),
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
