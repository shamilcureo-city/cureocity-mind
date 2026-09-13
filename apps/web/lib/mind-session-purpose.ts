import { sessionKindForMindPurpose, type MindSessionPurpose } from '@cureocity/contracts';
import type { Session } from '@prisma/client';
import { prisma } from './prisma';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from './phi-write-lock';
import { writeAudit } from './audit';

export class MindPurposeConflict extends Error {}

/** Revalidate every reuse under the erasure lock, even without a new purpose. */
export async function selectMindSessionPurpose(
  row: Session,
  psychologistId: string,
  purpose?: MindSessionPurpose,
): Promise<Session> {
  return prisma.$transaction(async (tx) => {
    const client = await lockActiveClientForSession(tx, row.id, psychologistId);
    await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${row.id} FOR UPDATE`;
    const current = await tx.session.findUnique({ where: { id: row.id } });
    if (
      !current ||
      current.psychologistId !== psychologistId ||
      current.clientId !== client.id ||
      current.clientId !== row.clientId
    )
      throw new ClientPhiWriteForbiddenError();
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(current.status))
      throw new MindPurposeConflict(
        'This booking is no longer available to start. Return to Today to choose the current session.',
      );
    if (!purpose) return current;
    if (current.mindPurpose === purpose) return current;
    if (current.status !== 'SCHEDULED' || current.updatedAt.getTime() !== row.updatedAt.getTime()) {
      throw new MindPurposeConflict(
        'This session has already started or changed. Reopen it to continue with its saved purpose.',
      );
    }
    const updated = await tx.session.update({
      where: { id: row.id },
      data: {
        mindPurpose: purpose,
        kind: sessionKindForMindPurpose(purpose),
        ...(purpose === 'ASSESSMENT' ? { noteTemplateId: null, modality: null } : {}),
        ...(purpose === 'COUNSELLING' ? { modality: 'SUPPORTIVE' } : {}),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psychologistId,
        action: 'SESSION_PURPOSE_SELECTED',
        targetType: 'Session',
        targetId: row.id,
        metadata: { purpose, previousKind: current.kind, kind: updated.kind },
      },
      tx,
    );
    return updated;
  });
}
