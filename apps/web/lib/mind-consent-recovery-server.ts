import { createHash } from 'node:crypto';
import {
  SessionConsentSnapshotEntrySchema,
  SessionConsentSnapshotSchema,
  type SessionConsentSnapshot,
} from '@cureocity/contracts';
import { z } from 'zod';
import type { Consent, Prisma, SessionStatus } from '@prisma/client';
import {
  MIND_CONSENT_RECOVERY_SCOPES,
  MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  type MindConsentRecoveryState,
} from './mind-consent-recovery';

export class MindConsentRecoveryConflict extends Error {
  constructor(message = 'Consent or session details changed. Reload and confirm consent again.') {
    super(message);
    this.name = 'MindConsentRecoveryConflict';
  }
}

export type RecoveryStandingConsent = Pick<
  Consent,
  | 'id'
  | 'scope'
  | 'status'
  | 'scriptVersion'
  | 'capturedVia'
  | 'grantedAt'
  | 'withdrawnAt'
  | 'expiresAt'
  | 'updatedAt'
>;

export type RecoverySession = {
  id: string;
  clientId: string;
  psychologistId: string;
  status: SessionStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  consentSnapshot: Prisma.JsonValue | null;
  therapyNote: { id: string } | null;
};

export const MAX_RECOVERY_SNAPSHOT_ENTRIES = 300;
const ExistingRecoverySnapshotSchema = SessionConsentSnapshotSchema.extend({
  entries: z.array(SessionConsentSnapshotEntrySchema.strict()).max(MAX_RECOVERY_SNAPSHOT_ENTRIES),
}).strict();

export function readRecoverySnapshot(raw: Prisma.JsonValue | null): SessionConsentSnapshot {
  if (raw === null) return { entries: [], notes: null };
  const parsed = ExistingRecoverySnapshotSchema.safeParse(raw);
  if (!parsed.success)
    throw new MindConsentRecoveryConflict('The saved consent record needs review before recovery.');
  return parsed.data;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export const consentRecoveryHash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

export function isCurrentRecoveryGrant(row: RecoveryStandingConsent, now: Date): boolean {
  return (
    row.status === 'GRANTED' &&
    row.withdrawnAt === null &&
    (row.expiresAt === null || row.expiresAt > now)
  );
}

export function recoveryState(
  session: RecoverySession,
  standing: RecoveryStandingConsent[],
  now: Date,
): MindConsentRecoveryState {
  if (!['SCHEDULED', 'IN_PROGRESS'].includes(session.status) || session.therapyNote)
    throw new MindConsentRecoveryConflict('Consent recovery is closed for this session.');
  const snapshot = readRecoverySnapshot(session.consentSnapshot);
  const scopes = MIND_CONSENT_RECOVERY_SCOPES.map((scope) => {
    const rows = standing.filter((row) => row.scope === scope);
    const latest = [...rows].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id),
    )[0];
    const standingStatus = rows.some((row) => isCurrentRecoveryGrant(row, now))
      ? ('GRANTED' as const)
      : !latest
        ? ('MISSING' as const)
        : latest.status === 'WITHDRAWN' || latest.withdrawnAt !== null
          ? ('WITHDRAWN' as const)
          : ('EXPIRED' as const);
    return {
      scope,
      sessionAcknowledged: snapshot.entries.some((entry) => entry.scope === scope),
      standingStatus,
    };
  });
  return {
    sessionId: session.id,
    status: session.status as MindConsentRecoveryState['status'],
    scriptVersion: MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
    // Include effective status so a grant expiring between GET and POST also
    // invalidates the user's review even without a database mutation.
    revision: consentRecoveryHash({
      session,
      standing: [...standing].sort((a, b) => a.id.localeCompare(b.id)),
      scopes,
    }),
    scopes,
    ready: scopes.every((scope) => scope.sessionAcknowledged && scope.standingStatus === 'GRANTED'),
  };
}

/** Retain consent history without copying a clinician's free-text notes to audit. */
export function consentSnapshotAuditMetadata(snapshot: SessionConsentSnapshot) {
  return snapshot.entries.map(({ scope, scriptVersion, ackedAt }) => ({
    scope,
    scriptVersion,
    ackedAt,
  }));
}
