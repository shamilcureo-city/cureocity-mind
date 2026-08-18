import type { Prisma } from '@prisma/client';

export class ClientPhiWriteForbiddenError extends Error {
  constructor() {
    super('Client not found or has been erased');
    this.name = 'ClientPhiWriteForbiddenError';
  }
}

type LockedClient = { id: string; psychologistId: string };

export type LockedSessionForPhiWrite = {
  id: string;
  clientId: string;
  psychologistId: string;
  status: string;
};

interface PhiWriteDatabase {
  $transaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

/**
 * Global PHI write lock. Every client-scoped clinical writer acquires the
 * Client row first and rechecks the terminal deletion predicate while locked.
 * DPDP erasure takes the same row lock and sets deletedAt before redaction, so
 * a writer commits wholly before erasure or fails closed after it.
 */
export async function lockActiveClient(
  tx: Prisma.TransactionClient,
  clientId: string,
  psychologistId?: string,
): Promise<LockedClient> {
  const rows = await tx.$queryRaw<LockedClient[]>`
    SELECT c."id", c."psychologistId"
    FROM "clients" c
    WHERE c."id" = ${clientId}
      AND c."deletedAt" IS NULL
    FOR UPDATE OF c
  `;
  const client = rows[0];
  if (!client || (psychologistId !== undefined && client.psychologistId !== psychologistId)) {
    throw new ClientPhiWriteForbiddenError();
  }
  return client;
}

export async function lockActiveClientForSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  psychologistId?: string,
): Promise<LockedClient> {
  const rows = await tx.$queryRaw<LockedClient[]>`
    SELECT c."id", c."psychologistId"
    FROM "clients" c
    JOIN "sessions" s ON s."clientId" = c."id"
    WHERE s."id" = ${sessionId}
      AND c."deletedAt" IS NULL
    FOR UPDATE OF c
  `;
  const client = rows[0];
  if (!client || (psychologistId !== undefined && client.psychologistId !== psychologistId)) {
    throw new ClientPhiWriteForbiddenError();
  }
  return client;
}

/**
 * Open a short PHI persistence transaction after all network/LLM work is done.
 * The Client lock serializes against erasure; the Session reread prevents stale
 * ownership/client linkage from authorizing a delayed asynchronous write.
 */
export async function withActiveSessionPhiWrite<T>(
  db: PhiWriteDatabase,
  sessionId: string,
  psychologistId: string,
  write: (tx: Prisma.TransactionClient, session: LockedSessionForPhiWrite) => Promise<T>,
  options?: { allowedStatuses?: readonly string[] },
): Promise<T> {
  return db.$transaction(async (tx) => {
    const client = await lockActiveClientForSession(tx, sessionId, psychologistId);
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      select: { id: true, clientId: true, psychologistId: true, status: true },
    });
    if (
      !session ||
      session.clientId !== client.id ||
      session.psychologistId !== psychologistId ||
      (options?.allowedStatuses !== undefined && !options.allowedStatuses.includes(session.status))
    ) {
      throw new ClientPhiWriteForbiddenError();
    }
    return write(tx, session);
  });
}
