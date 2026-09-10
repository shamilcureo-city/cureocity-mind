import type { Prisma } from '@prisma/client';
import { lockActiveClient } from './phi-write-lock';
import { toSessionAgreementDto } from './session-agreement-view';

/** Full care-decision history is part of the client's export, not only an audit hash. */
export async function loadClientAgreementExport(
  tx: Prisma.TransactionClient,
  clientId: string,
  psychologistId: string,
) {
  await lockActiveClient(tx, clientId, psychologistId);
  const rows = await tx.sessionAgreement.findMany({
    where: { clientId, psychologistId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toSessionAgreementDto);
}
