import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from './prisma';

export class ConsentAuthorizationError extends Error {
  readonly code = 'SESSION_CONSENT_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ConsentAuthorizationError';
  }
}

export function consentAuthorizationResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ConsentAuthorizationError)) return null;
  return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
}

/**
 * Serialize capture authorization and standing-consent mutations for one
 * client. PostgreSQL holds this row lock until the caller's outer transaction
 * commits or rolls back.
 */
export async function withClientConsentLock<T>(
  tx: Prisma.TransactionClient,
  clientId: string,
  operation: () => Promise<T>,
): Promise<T> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "clients" WHERE "id" = ${clientId} FOR UPDATE`);
  return operation();
}

/**
 * Batch E — the consent WITHDRAWAL check at capture time.
 *
 * Both capture routes (`/sessions/:id/start` and `/sessions/:id/live-token`)
 * validated consent exactly once: when a SCHEDULED session had no snapshot
 * yet. After that the snapshot was treated as permanent proof. But consent
 * under the DPDP Act is withdrawable at any time, and `Consent.withdrawnAt`
 * is a column this codebase already writes — nothing read it at the moment it
 * matters most. A patient who withdrew recording consent last week could
 * still be recorded today, because the session (or a re-used IN_PROGRESS one)
 * carried a snapshot from before the withdrawal.
 *
 * This checks the STANDING consent rows on every capture attempt. A snapshot
 * proves consent was given; only the live rows prove it still holds.
 */

/** The scopes the scribe pipeline needs, in both verticals. */
export const SCRIBE_CONSENT_SCOPES = [
  'AUDIO_RECORDING',
  'AI_NOTE_GENERATION',
  'CROSS_BORDER_PROCESSING',
] as const;

export type ScribeConsentScope = (typeof SCRIBE_CONSENT_SCOPES)[number];

export interface WithdrawnConsentResult {
  withdrawn: ScribeConsentScope[];
}

/**
 * Scopes the client has explicitly WITHDRAWN. Empty ⇒ nothing was revoked.
 *
 * Deliberately narrow: this reports scopes with a withdrawal on record, not
 * scopes that are merely absent. A missing consent row is the pre-existing
 * "never granted" case the snapshot logic already handles; conflating the two
 * would break every session created before a scope existed.
 */
export async function withdrawnScribeConsents(
  clientId: string,
  db: Pick<Prisma.TransactionClient, 'consent'> = prisma,
): Promise<ScribeConsentScope[]> {
  const rows = await db.consent.findMany({
    where: {
      clientId,
      scope: { in: [...SCRIBE_CONSENT_SCOPES] },
      OR: [{ withdrawnAt: { not: null } }, { status: 'WITHDRAWN' }],
    },
    select: { scope: true, withdrawnAt: true, status: true },
  });
  const withdrawn = new Set<ScribeConsentScope>();
  for (const row of rows) {
    const scope = row.scope as ScribeConsentScope;
    // A later GRANTED row for the same scope re-authorises it, so only treat
    // the scope as withdrawn when no active grant supersedes the withdrawal.
    withdrawn.add(scope);
  }
  if (withdrawn.size === 0) return [];
  const active = await db.consent.findMany({
    where: {
      clientId,
      scope: { in: [...withdrawn] },
      status: 'GRANTED',
      withdrawnAt: null,
    },
    select: { scope: true },
  });
  for (const row of active) withdrawn.delete(row.scope as ScribeConsentScope);
  return [...withdrawn];
}

/** Human-readable refusal for a capture blocked by a withdrawal. */
export function withdrawalRefusalMessage(scopes: ScribeConsentScope[]): string {
  return (
    `The patient has withdrawn consent for ${scopes.join(', ')}. ` +
    `Recording cannot start until that consent is granted again on the patient's record. ` +
    `Document this encounter by hand, or capture fresh consent first.`
  );
}
