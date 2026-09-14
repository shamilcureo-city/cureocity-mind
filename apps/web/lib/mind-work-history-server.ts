import type { Prisma } from '@prisma/client';
import {
  MIND_WORK_HISTORY_PAGE_SIZE,
  MindWorkHistoryPageSchema,
  MindWorkHistoryQuerySchema,
  type MindWorkHistoryEntry,
  type MindWorkHistoryPage,
  type MindWorkHistoryQuery,
} from '@cureocity/contracts';
import { lockActiveClient } from './phi-write-lock';
import { toMindCareRecordDto } from './mind-care-record';

export class MindWorkHistoryUnavailableError extends Error {
  constructor() {
    super('Saved work history could not be verified.');
    this.name = 'MindWorkHistoryUnavailableError';
  }
}

/** Bounded encrypted projection; the caller owns the transaction and view audit. */
export async function loadMindWorkHistoryPage(
  tx: Prisma.TransactionClient,
  clientId: string,
  psychologistId: string,
  requested: MindWorkHistoryQuery,
): Promise<MindWorkHistoryPage> {
  const query = MindWorkHistoryQuerySchema.parse(requested);
  await lockActiveClient(tx, clientId, psychologistId);
  const where = { clientId, psychologistId };
  const latest = await tx.clientMindCareRecord.findFirst({
    where,
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const latestVersion = latest?.version ?? 0;
  if (
    !Number.isSafeInteger(latestVersion) ||
    latestVersion < 0 ||
    latestVersion > 2_147_483_647 ||
    (latest !== null && latestVersion === 0)
  )
    throw new MindWorkHistoryUnavailableError();
  const snapshotVersion = query.snapshotVersion ?? latestVersion;
  if (snapshotVersion > latestVersion) throw new MindWorkHistoryUnavailableError();
  const beforeVersion = query.beforeVersion ?? null;
  const firstVersion = beforeVersion === null ? snapshotVersion : beforeVersion - 1;
  const entries: MindWorkHistoryEntry[] = [];
  let nextBeforeVersion: number | null = null;

  if (firstVersion > 0) {
    const rows = await tx.clientMindCareRecord.findMany({
      where: {
        ...where,
        version: { lte: snapshotVersion, ...(beforeVersion && { lt: beforeVersion }) },
      },
      orderBy: { version: 'desc' },
      take: MIND_WORK_HISTORY_PAGE_SIZE + 1,
      select: {
        id: true,
        clientId: true,
        psychologistId: true,
        version: true,
        operationId: true,
        bodyEncrypted: true,
        createdAt: true,
      },
    });
    // Every writer appends expectedVersion + 1. Missing rows or a missing predecessor
    // must not turn a copied-forward entry into a fabricated new work event.
    if (rows.length !== Math.min(firstVersion, MIND_WORK_HISTORY_PAGE_SIZE + 1))
      throw new MindWorkHistoryUnavailableError();
    for (const [index, row] of rows.entries()) {
      if (
        row.version !== firstVersion - index ||
        row.clientId !== clientId ||
        row.psychologistId !== psychologistId
      )
        throw new MindWorkHistoryUnavailableError();
    }
    const decoded = await Promise.all(rows.map(toMindCareRecordDto));
    for (let index = 0; index < Math.min(rows.length, MIND_WORK_HISTORY_PAGE_SIZE); index++) {
      const current = decoded[index]!;
      const work = current.body.sessionWork;
      const previousWork = decoded[index + 1]?.body.sessionWork;
      if (work && JSON.stringify(work) !== JSON.stringify(previousWork))
        entries.push({ recordVersion: current.version, savedAt: current.createdAt, work });
    }
    if (rows.length > MIND_WORK_HISTORY_PAGE_SIZE)
      nextBeforeVersion = rows[MIND_WORK_HISTORY_PAGE_SIZE - 1]!.version;

    if (entries.length) {
      const sourceIds = [...new Set(entries.map((entry) => entry.work.sessionId))];
      const sessions = await tx.session.findMany({
        where: { id: { in: sourceIds }, clientId, psychologistId },
        select: { id: true, clientId: true, psychologistId: true },
      });
      const confirmed = new Set(
        sessions
          .filter(
            (session) => session.clientId === clientId && session.psychologistId === psychologistId,
          )
          .map((session) => session.id),
      );
      if (sourceIds.some((id) => !confirmed.has(id))) throw new MindWorkHistoryUnavailableError();
    }
  }
  return MindWorkHistoryPageSchema.parse({
    clientId,
    snapshotVersion,
    beforeVersion,
    nextBeforeVersion,
    entries,
    hasMore: nextBeforeVersion !== null,
  });
}
