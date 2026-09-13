import {
  MindSessionPreparationBodySchema,
  MindSessionPreparationSchema,
  type MindSessionPreparation,
} from '@cureocity/contracts';
import type { Prisma } from '@prisma/client';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from './phi-write-lock';
import { decryptForTenant } from './tenant-crypto';

export class MindSessionPreparationUnreadableError extends Error {
  constructor() {
    super('The saved preparation could not be read.');
    this.name = 'MindSessionPreparationUnreadableError';
  }
}

export type MindSessionPreparationRow = {
  id: string;
  sessionId: string;
  psychologistId: string;
  revision: number;
  operationId: string;
  bodyEncrypted: string;
  createdAt: Date;
};

/** No plaintext fallback: unreadable history is never an empty preparation. */
export async function toMindSessionPreparationDto(
  row: MindSessionPreparationRow,
): Promise<MindSessionPreparation> {
  try {
    const plaintext = await decryptForTenant(row.psychologistId, row.bodyEncrypted);
    const body = MindSessionPreparationBodySchema.parse(
      plaintext === null ? null : JSON.parse(plaintext),
    );
    return MindSessionPreparationSchema.parse({
      id: row.id,
      sessionId: row.sessionId,
      psychologistId: row.psychologistId,
      revision: row.revision,
      operationId: row.operationId,
      body,
      createdAt: row.createdAt.toISOString(),
    });
  } catch {
    // Do not propagate raw crypto/provider errors or clinical values into route logs.
    throw new MindSessionPreparationUnreadableError();
  }
}

/** Client first, exact Session second: serialize both reads/writes against erasure/start. */
export async function lockMindPreparationSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  psychologistId: string,
) {
  const client = await lockActiveClientForSession(tx, sessionId, psychologistId);
  await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: { id: true, clientId: true, psychologistId: true, scheduledAt: true, status: true },
  });
  if (
    !session ||
    session.id !== sessionId ||
    session.psychologistId !== psychologistId ||
    session.clientId !== client.id
  )
    throw new ClientPhiWriteForbiddenError();
  return session;
}

export async function toOwnedMindSessionPreparationDto(
  row: MindSessionPreparationRow,
  sessionId: string,
  psychologistId: string,
): Promise<MindSessionPreparation> {
  if (row.sessionId !== sessionId || row.psychologistId !== psychologistId)
    throw new MindSessionPreparationUnreadableError();
  return toMindSessionPreparationDto(row);
}
