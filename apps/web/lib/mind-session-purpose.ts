import { sessionKindForMindPurpose, type MindSessionPurpose } from '@cureocity/contracts';
import type { Session } from '@prisma/client';
import { prisma } from './prisma';
import { lockActiveClientForSession } from './phi-write-lock';
import { writeAudit } from './audit';

export class MindPurposeConflict extends Error {}

/** Reused bookings must honor intent too, but an active visit's meaning is immutable. */
export async function selectMindSessionPurpose(
  row: Session,
  psychologistId: string,
  purpose?: MindSessionPurpose,
): Promise<Session> {
  if (!purpose) return row;
  return prisma.$transaction(async (tx) => {
    await lockActiveClientForSession(tx, row.id, psychologistId);
    const current = await tx.session.findUnique({ where: { id: row.id } });
    if (!current || current.psychologistId !== psychologistId)
      throw new MindPurposeConflict('Session not found.');
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
