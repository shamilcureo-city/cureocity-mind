import type { Prisma } from '@prisma/client';
import {
  SessionUsageConnectionExportSchema,
  type SessionUsageConnectionExport,
} from '@cureocity/contracts';
import { lockActiveClient } from './phi-write-lock';
import { hasSessionUsageConnectionStorage } from './session-usage-storage';
import { validateStoredSessionUsage } from './session-usage-integrity';

/** Accounting is patient-linked metadata, so its reader and erasure outlive reporting flags. */
export async function loadSessionUsageDataExport(
  tx: Prisma.TransactionClient,
  clientId: string,
  psychologistId: string,
): Promise<SessionUsageConnectionExport[]> {
  await lockActiveClient(tx, clientId, psychologistId);
  if (!(await hasSessionUsageConnectionStorage(tx))) return [];
  const rows = await tx.sessionUsageConnection.findMany({
    where: { clientId, psychologistId, session: { clientId, psychologistId } },
    orderBy: [{ sessionId: 'asc' }, { registeredAt: 'asc' }, { connectionId: 'asc' }],
  });
  return rows.map((row) => {
    if (row.clientId !== clientId || row.psychologistId !== psychologistId)
      throw new Error('Session usage export contains inconsistent history');
    const receipt = validateStoredSessionUsage(row);
    return SessionUsageConnectionExportSchema.parse({
      sessionId: row.sessionId,
      startedAt: row.startedAt.toISOString(),
      registeredAt: row.registeredAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      backend: row.backend,
      state: row.state,
      totals: receipt?.totals ?? null,
      usageBasis: receipt?.usageBasis ?? null,
      coverageReasons: receipt?.coverageReasons ?? [],
      provenance: receipt?.provenance ?? null,
    });
  });
}
