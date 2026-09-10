import type { PrismaClient } from '@prisma/client';
import { toSessionAgreementDto } from './session-agreement-view';

/** Oldest unfinished commitments first; never infer that a short page is the whole case. */
export async function loadActiveSessionAgreements(
  db: Pick<PrismaClient, 'sessionAgreement'>,
  clientId: string,
  psychologistId: string,
  cursor?: string,
) {
  const where = {
    clientId,
    psychologistId,
    retiredAt: null,
    OR: [
      { followUp: null },
      { followUp: { in: ['PARTLY', 'NOT_YET'] as ('PARTLY' | 'NOT_YET')[] } },
    ],
    session: { status: 'COMPLETED' as const, psychologistId, clientId },
    client: { deletedAt: null },
  };
  const [total, rows] = await Promise.all([
    db.sessionAgreement.count({ where }),
    db.sessionAgreement.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        session: { select: { scheduledAt: true } },
        homeworkAssignments: {
          select: {
            id: true,
            sourceAgreementRevision: true,
            customDescription: true,
            dueAt: true,
            status: true,
          },
          orderBy: { assignedAt: 'asc' },
        },
      },
    }),
  ]);
  return {
    agreements: rows.slice(0, 20).map(toSessionAgreementDto),
    total,
    nextCursor: rows.length > 20 ? rows[19]!.id : null,
  };
}
