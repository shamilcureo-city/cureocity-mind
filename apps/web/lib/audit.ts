import { Prisma } from '@prisma/client';
import type { AuditAction, AuditActorType, AuditMetadata } from '@cureocity/contracts';
import { recordAuditWrite } from '@cureocity/observability/metrics';
import { prisma } from './prisma';

/**
 * Audit log helper — ported from the 6 NestJS services' AuditService.
 *
 * Pass `tx` when the audit write must be atomic with a business write
 * (mirrors the original NestJS pattern).
 *
 * The chaos-audit coverage test (Sprint 9 PR 4) scans for action
 * literals in writer sites — calls that route through this helper
 * count too, so every action that flows here is covered.
 */

export interface AuditWrite {
  actorType: AuditActorType;
  actorPsychologistId?: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata?: AuditMetadata;
}

export async function writeAudit(input: AuditWrite, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? prisma;
  await client.auditLog.create({
    data: {
      actorType: input.actorType,
      actorPsychologistId: input.actorPsychologistId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata:
        input.metadata === undefined ? Prisma.JsonNull : (input.metadata as Prisma.InputJsonValue),
    },
  });
  recordAuditWrite(input.action, input.actorType);
}

/**
 * Best-effort request metadata extractor — every route handler that
 * audits a write calls this with the incoming Request so we have ip /
 * userAgent / requestId in the row.
 */
export function auditMetadataFromRequest(req: Request): AuditMetadata {
  const meta: AuditMetadata = {};
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    undefined;
  if (ip) meta.ip = ip;
  const ua = req.headers.get('user-agent');
  if (ua) meta.userAgent = ua;
  const requestId = req.headers.get('x-request-id') ?? req.headers.get('x-vercel-id') ?? undefined;
  if (requestId) meta.requestId = requestId;
  return meta;
}
