import type { PatientShareChannel, PatientShareSnapshot } from '@cureocity/contracts';
import { Prisma, type PatientShareStatus } from '@prisma/client';

/**
 * Serializes the start of external share submission with client erasure.
 * Provider I/O happens after this transaction-scoped lock is released; the
 * durable PENDING + dispatchStartedAt marker then represents SUBMITTING.
 */
export async function lockClientShareDispatch(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  clientId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`client-share-dispatch:${clientId}`}))`,
  );
}

export async function readWinningShareDispatch(
  row: {
    psychologistId: string;
    channel: PatientShareChannel;
    recipientEnvelopeEncrypted: string | null;
    therapistMessageEncrypted: string | null;
    subject: string;
    snapshot: unknown;
    language: string;
  },
  deps: {
    decryptRecipient: (
      psychologistId: string,
      encrypted: string | null,
      channel: PatientShareChannel,
    ) => Promise<{ destination: string | null; clientFirstName: string } | null>;
    decryptMessage: (
      psychologistId: string,
      encrypted: string | null,
    ) => Promise<{ ok: true; value: string | null } | { ok: false }>;
  },
): Promise<{
  destination: string | null;
  clientFirstName: string;
  therapistMessage: string | undefined;
  subject: string;
  snapshot: PatientShareSnapshot;
  language: string;
} | null> {
  const [recipient, message] = await Promise.all([
    deps.decryptRecipient(row.psychologistId, row.recipientEnvelopeEncrypted, row.channel),
    deps.decryptMessage(row.psychologistId, row.therapistMessageEncrypted),
  ]);
  if (!recipient || !message.ok) return null;
  return {
    destination: recipient.destination,
    clientFirstName: recipient.clientFirstName,
    therapistMessage: message.value ?? undefined,
    subject: row.subject,
    snapshot: row.snapshot as PatientShareSnapshot,
    language: row.language,
  };
}

export async function finalizeLeasedShare(
  tx: Pick<Prisma.TransactionClient, 'patientShare'>,
  args: {
    rowId: string;
    leaseOwner?: string;
    leaseVersion?: number;
    status: PatientShareStatus;
    sentAt?: Date;
    providerMessageId: string | null;
    errorCode: string | null;
    audit: (tx: Pick<Prisma.TransactionClient, 'patientShare'>) => Promise<void>;
  },
) {
  const finalized = await tx.patientShare.updateMany({
    where: {
      id: args.rowId,
      status: 'PENDING',
      ...(args.leaseOwner && { dispatchLeaseOwner: args.leaseOwner }),
      ...(args.leaseVersion !== undefined && { dispatchLeaseVersion: args.leaseVersion }),
    },
    data: {
      status: args.status,
      ...(args.sentAt && { sentAt: args.sentAt }),
      ...(args.providerMessageId !== null && { providerMessageId: args.providerMessageId }),
      ...(args.errorCode !== null && { errorCode: args.errorCode }),
      dispatchLeaseExpiresAt: null,
      dispatchLeaseOwner: null,
    },
  });
  const updated = await tx.patientShare.findUniqueOrThrow({ where: { id: args.rowId } });
  if (finalized.count === 1) await args.audit(tx);
  return updated;
}
