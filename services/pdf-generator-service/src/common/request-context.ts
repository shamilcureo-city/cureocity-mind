import type { Request } from 'express';
import type { AuditMetadata } from '@cureocity/contracts';

/**
 * Extracts non-PII request metadata for audit logs.
 * Trust boundary: ip + userAgent come from the request as-is; downstream
 * consumers (e.g. SIEM in Sprint 9) must treat them as untrusted strings.
 */
export function auditMetadataFromRequest(req: Request): AuditMetadata {
  const xff = req.headers['x-forwarded-for'];
  const xffFirst = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
  return {
    ip: xffFirst ?? req.ip,
    userAgent: req.headers['user-agent'],
    requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
  };
}
