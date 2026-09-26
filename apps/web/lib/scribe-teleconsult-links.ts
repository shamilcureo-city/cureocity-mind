import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ScribeWorkspaceError } from './scribe-workspace-auth';
import type { ScribeTeleconsultBody } from './scribe-teleconsult-contracts';

const LinkSchema = z
  .object({
    v: z.literal(1),
    product: z.literal('SCRIBE'),
    id: z.string().min(1).max(160),
    psychologistId: z.string().min(1).max(160),
    clientId: z.string().min(1).max(160),
    sessionId: z.string().min(1).max(160),
    linkVersion: z.string().uuid(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type ScribeTeleconsultLink = z.infer<typeof LinkSchema>;

export function isScribeTeleconsultEnabled(): boolean {
  return process.env['SCRIBE_TELECONSULT_ENABLED'] === 'true';
}
function secret(): string {
  const value = process.env['SCRIBE_TELECONSULT_LINK_SECRET'] ?? '';
  // No development fallback: an accidentally exposed preview must also fail closed.
  if (Buffer.byteLength(value, 'utf8') < 32 || new Set(value).size < 12) {
    throw new ScribeWorkspaceError(503, 'Secure teleconsult links are not configured.');
  }
  return value;
}
export function scribeTeleconsultConfigured(): boolean {
  try {
    secret();
    const url = new URL(process.env['LIVEKIT_URL'] ?? '');
    return (
      isScribeTeleconsultEnabled() &&
      ['wss:', 'https:'].includes(url.protocol) &&
      Boolean(process.env['LIVEKIT_API_KEY'] && process.env['LIVEKIT_API_SECRET'])
    );
  } catch {
    return false;
  }
}
export function assertScribeTeleconsultEnabled(): void {
  if (!isScribeTeleconsultEnabled())
    throw new ScribeWorkspaceError(404, 'Teleconsult is unavailable.');
}
export function assertScribeTeleconsultConfigured(): void {
  assertScribeTeleconsultEnabled();
  if (!scribeTeleconsultConfigured())
    throw new ScribeWorkspaceError(503, 'Teleconsult is not configured.');
}
export function scribeTeleconsultId(sessionId: string): string {
  return `teleconsult-${createHash('sha256').update(sessionId).digest('hex').slice(0, 40)}`;
}
export function signScribeTeleconsultLink(id: string, body: ScribeTeleconsultBody): string {
  const payload: ScribeTeleconsultLink = {
    v: 1,
    product: 'SCRIBE',
    id,
    psychologistId: body.psychologistId,
    clientId: body.clientId,
    sessionId: body.sessionId,
    linkVersion: body.linkVersion,
    expiresAt: body.expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(LinkSchema.parse(payload))).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret()).update(encoded).digest('base64url')}`;
}
/** Expiry is checked against the stored call so an expired link can show a safe closed screen. */
export function verifyScribeTeleconsultLink(token: string, id: string): ScribeTeleconsultLink {
  const invalid = () => new ScribeWorkspaceError(404, 'This teleconsult link is unavailable.');
  if (token.length > 4096) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw invalid();
  const expected = createHmac('sha256', secret()).update(parts[0]!).digest();
  const actual = Buffer.from(parts[1]!, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  try {
    const payload = LinkSchema.parse(
      JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')),
    );
    if (payload.id !== id) throw invalid();
    return payload;
  } catch {
    throw invalid();
  }
}
export function assertScribeTeleconsultLinkBinding(
  link: ScribeTeleconsultLink,
  body: ScribeTeleconsultBody,
): void {
  if (
    link.product !== body.product ||
    link.psychologistId !== body.psychologistId ||
    link.clientId !== body.clientId ||
    link.sessionId !== body.sessionId ||
    link.linkVersion !== body.linkVersion ||
    link.expiresAt !== body.expiresAt
  ) {
    throw new ScribeWorkspaceError(404, 'This teleconsult link is unavailable.');
  }
}
