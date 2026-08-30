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

/** Standing preference never substitutes for today's scheduled-session ack. */
export function requiresTodaySessionConfirmation(
  status: 'SCHEDULED' | 'IN_PROGRESS',
  confirmedToday: boolean,
): boolean {
  return status === 'SCHEDULED' && !confirmedToday;
}

/**
 * Fail-closed capture authorization shared by batch start, live start, and
 * live reconnect. Callers must hold the client consent lock while awaiting
 * this function so a concurrent withdrawal cannot race token mint/start.
 */
export async function assertValidScribeConsent(
  snapshot: Prisma.JsonValue | null,
  clientId: string,
  db: Pick<Prisma.TransactionClient, 'consent'> = prisma,
  now = new Date(),
): Promise<void> {
  const entries =
    snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot.entries
      : null;
  const snapshotScopes = new Set(
    (Array.isArray(entries) ? entries : []).map((entry) =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? entry.scope
        : undefined,
    ),
  );
  const missingFromSnapshot = SCRIBE_CONSENT_SCOPES.filter((scope) => !snapshotScopes.has(scope));
  if (missingFromSnapshot.length > 0) {
    throw new ConsentAuthorizationError(
      `Session consent snapshot is missing required scopes: ${missingFromSnapshot.join(', ')}`,
    );
  }

  const rows = await db.consent.findMany({
    where: {
      clientId,
      scope: { in: [...SCRIBE_CONSENT_SCOPES] },
    },
    select: { scope: true, status: true, withdrawnAt: true, expiresAt: true },
  });
  const validScopes = new Set<ScribeConsentScope>();
  for (const row of rows) {
    if (
      row.status === 'GRANTED' &&
      row.withdrawnAt === null &&
      (row.expiresAt === null || row.expiresAt > now)
    ) {
      validScopes.add(row.scope as ScribeConsentScope);
    }
  }
  const missingStandingGrants = SCRIBE_CONSENT_SCOPES.filter((scope) => !validScopes.has(scope));
  if (missingStandingGrants.length > 0) {
    throw new ConsentAuthorizationError(
      `Current standing consent does not cover required scopes: ${missingStandingGrants.join(', ')}`,
    );
  }
}
