import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { sendCrisisAlert } from '@/lib/crisis-alert';
import { publicBaseUrl } from '@/lib/appointment-links';

interface PendingRow {
  id: string;
}
interface StaleRow extends PendingRow {
  clientId: string;
  psychologistId: string;
  submissionStartedAt: Date | null;
}
interface Recipient {
  to: string;
  therapistName: string;
  clientRecordUrl: string;
}
interface FinalOutcome {
  status: 'SENT' | 'FAILED' | 'UNKNOWN';
  providerMessageId: string | null;
  errorCode: string | null;
  completedAt: Date;
}

export interface CrisisOutboxDeps {
  listStaleStarted(cutoff: Date, limit: number): Promise<StaleRow[]>;
  terminalizeUnknown(id: string, startedBefore: Date): Promise<boolean | { count: number }>;
  listPending(now: Date, limit: number, ids?: readonly string[]): Promise<PendingRow[]>;
  claimPending(id: string, owner: string, leaseExpiresAt: Date): Promise<boolean>;
  failPending(id: string, owner: string, outcome: FinalOutcome): Promise<boolean>;
  markSubmissionStarted(id: string, owner: string, at: Date): Promise<boolean>;
  loadRecipient(id: string): Promise<Recipient | null>;
  send(args: Recipient & { idempotencyKey: string }): Promise<{
    outcome: 'sent' | 'transient_failure' | 'permanent_failure';
    providerMessageId?: string;
    errorCode?: string;
  }>;
  finalize(id: string, owner: string, outcome: FinalOutcome): Promise<boolean>;
  audit(event: { id: string; outcome: string; errorCode?: string | null }): Promise<void>;
}

export async function processCrisisAlertOutbox(
  args: {
    now?: Date;
    limit?: number;
    staleAfterMs?: number;
    ids?: readonly string[];
    deps?: CrisisOutboxDeps;
  } = {},
): Promise<{ sent: number; failed: number; unknown: number; failures: string[] }> {
  const now = args.now ?? new Date();
  const limit = args.limit ?? 25;
  const staleAfterMs = args.staleAfterMs ?? 10 * 60_000;
  const deps = args.deps ?? realDeps;
  const result = { sent: 0, failed: 0, unknown: 0, failures: [] as string[] };
  const cutoff = new Date(now.getTime() - staleAfterMs);

  for (const stale of await deps.listStaleStarted(cutoff, limit)) {
    const changed = await deps.terminalizeUnknown(stale.id, cutoff);
    const count = typeof changed === 'boolean' ? (changed ? 1 : 0) : changed.count;
    if (count !== 1) continue;
    result.unknown += 1;
    result.failures.push(stale.id);
    await deps.audit({ id: stale.id, outcome: 'unknown', errorCode: 'STALE_SUBMISSION_UNKNOWN' });
    console.error('[crisis-outbox] stale submission requires manual reconciliation', stale.id);
  }

  for (const row of await deps.listPending(now, limit, args.ids)) {
    const owner = randomBytes(24).toString('base64url');
    if (!(await deps.claimPending(row.id, owner, new Date(now.getTime() + 60_000)))) continue;
    const recipient = await deps.loadRecipient(row.id);
    if (!recipient) {
      const failed = await deps.failPending(row.id, owner, {
        status: 'FAILED',
        providerMessageId: null,
        errorCode: 'RECIPIENT_UNAVAILABLE',
        completedAt: now,
      });
      if (!failed) continue;
      result.failed += 1;
      result.failures.push(row.id);
      await deps.audit({ id: row.id, outcome: 'failed', errorCode: 'RECIPIENT_UNAVAILABLE' });
      continue;
    }
    // Commit the no-return provider boundary before submission. A crash after
    // this point is reconciled to UNKNOWN and is never automatically retried.
    if (!(await deps.markSubmissionStarted(row.id, owner, now))) continue;
    let final: FinalOutcome;
    try {
      const sent = await deps.send({ ...recipient, idempotencyKey: row.id });
      final =
        sent.outcome === 'sent'
          ? {
              status: 'SENT',
              providerMessageId: sent.providerMessageId ?? null,
              errorCode: null,
              completedAt: now,
            }
          : sent.outcome === 'permanent_failure'
            ? {
                status: 'FAILED',
                providerMessageId: sent.providerMessageId ?? null,
                errorCode: sent.errorCode ?? 'PERMANENT_PROVIDER_FAILURE',
                completedAt: now,
              }
            : {
                status: 'UNKNOWN',
                providerMessageId: sent.providerMessageId ?? null,
                errorCode: sent.errorCode ?? 'AMBIGUOUS_PROVIDER_OUTCOME',
                completedAt: now,
              };
    } catch {
      final = {
        status: 'UNKNOWN',
        providerMessageId: null,
        errorCode: 'DELIVERY_EXCEPTION',
        completedAt: now,
      };
    }
    if (!(await deps.finalize(row.id, owner, final))) continue;
    if (final.status === 'SENT') {
      result.sent += 1;
    } else if (final.status === 'FAILED') {
      result.failed += 1;
      result.failures.push(row.id);
      console.error('[crisis-outbox] permanent delivery failure', row.id, final.errorCode);
    } else {
      result.unknown += 1;
      result.failures.push(row.id);
      console.error('[crisis-outbox] provider outcome requires manual reconciliation', row.id);
    }
    await deps.audit({
      id: row.id,
      outcome: final.status.toLowerCase(),
      errorCode: final.errorCode,
    });
  }
  return result;
}

const realDeps: CrisisOutboxDeps = {
  listStaleStarted: (cutoff, limit) =>
    prisma.crisisAlertAttempt.findMany({
      where: { status: 'SUBMISSION_STARTED', submissionStartedAt: { lte: cutoff } },
      orderBy: [{ submissionStartedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    }),
  terminalizeUnknown: (id, cutoff) =>
    prisma.$transaction(async (tx) => {
      const changed = await tx.crisisAlertAttempt.updateMany({
        where: { id, status: 'SUBMISSION_STARTED', submissionStartedAt: { lte: cutoff } },
        data: {
          status: 'UNKNOWN',
          completedAt: new Date(),
          errorCode: 'STALE_SUBMISSION_UNKNOWN',
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (changed.count === 1)
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'THERAPIST_CRISIS_ALERTED',
            targetType: 'CrisisAlertAttempt',
            targetId: id,
            metadata: {
              outcome: 'unknown',
              errorCode: 'STALE_SUBMISSION_UNKNOWN',
              manualReconciliationRequired: true,
            },
          },
          tx,
        );
      return changed;
    }),
  listPending: (now, limit, ids) =>
    prisma.crisisAlertAttempt.findMany({
      where: {
        status: 'PENDING',
        ...(ids?.length ? { id: { in: [...ids] } } : {}),
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    }),
  claimPending: async (id, owner, leaseExpiresAt) =>
    (
      await prisma.crisisAlertAttempt.updateMany({
        where: {
          id,
          status: 'PENDING',
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
        },
        data: { leaseOwner: owner, leaseExpiresAt, attemptCount: { increment: 1 } },
      })
    ).count === 1,
  failPending: async (id, owner, outcome) =>
    await prisma.$transaction(async (tx) => {
      const changed = await tx.crisisAlertAttempt.updateMany({
        where: { id, status: 'PENDING', leaseOwner: owner },
        data: { ...outcome, leaseOwner: null, leaseExpiresAt: null },
      });
      if (changed.count !== 1) return false;
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'THERAPIST_CRISIS_ALERTED',
          targetType: 'CrisisAlertAttempt',
          targetId: id,
          metadata: { outcome: 'failed', errorCode: outcome.errorCode },
        },
        tx,
      );
      return true;
    }),
  markSubmissionStarted: async (id, owner, at) =>
    (
      await prisma.crisisAlertAttempt.updateMany({
        where: { id, status: 'PENDING', leaseOwner: owner },
        data: { status: 'SUBMISSION_STARTED', submissionStartedAt: at, leaseExpiresAt: null },
      })
    ).count === 1,
  loadRecipient: async (id) => {
    const attempt = await prisma.crisisAlertAttempt.findUnique({ where: { id } });
    if (!attempt) return null;
    const psychologist = await prisma.psychologist.findUnique({
      where: { id: attempt.psychologistId },
      select: { email: true, fullName: true },
    });
    if (!psychologist?.email) return null;
    return {
      to: psychologist.email,
      therapistName: psychologist.fullName || 'there',
      clientRecordUrl: `${publicBaseUrl().replace(/\/$/, '')}/app/clients/${attempt.clientId}`,
    };
  },
  send: (args) => sendCrisisAlert(args),
  finalize: async (id, owner, outcome) =>
    await prisma.$transaction(async (tx) => {
      const changed = await tx.crisisAlertAttempt.updateMany({
        where: { id, status: 'SUBMISSION_STARTED', leaseOwner: owner },
        data: { ...outcome, leaseOwner: null, leaseExpiresAt: null },
      });
      if (changed.count !== 1) return false;
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'THERAPIST_CRISIS_ALERTED',
          targetType: 'CrisisAlertAttempt',
          targetId: id,
          metadata: { outcome: outcome.status.toLowerCase(), errorCode: outcome.errorCode },
        },
        tx,
      );
      return true;
    }),
  audit: async () => {
    /* real finalization writes atomically; stale audit is added below by caller adapter follow-up */
  },
};
