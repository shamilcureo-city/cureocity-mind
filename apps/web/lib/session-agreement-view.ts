import { AgreementRevisionHistorySchema, type SessionAgreementDto } from '@cureocity/contracts';
import type { Prisma } from '@prisma/client';

export const agreementContextInclude = {
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
} satisfies Prisma.SessionAgreementInclude;

/** Agreement documentation alone does not authorize disclosing linked therapy homework. */
export function withAgreementHomeworkAccess(
  agreement: SessionAgreementDto,
  allowed: boolean,
): SessionAgreementDto {
  return {
    ...agreement,
    canUseAsHomework: allowed,
    homeworkAssignments: allowed ? agreement.homeworkAssignments : undefined,
  };
}

export function toSessionAgreementDto(row: {
  id: string;
  sessionId: string;
  clientId?: string;
  session?: { scheduledAt: Date };
  text: string;
  speaker: 'CLIENT' | 'THERAPIST';
  followUp: 'DONE' | 'PARTLY' | 'NOT_YET' | null;
  createdAt: Date;
  revision?: number;
  revisions?: unknown;
  retiredAt?: Date | null;
  retirementReason?: string | null;
  homeworkAssignments?: {
    id: string;
    sourceAgreementRevision: number | null;
    customDescription: string | null;
    dueAt: Date | null;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'EXPIRED';
  }[];
}): SessionAgreementDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    clientId: row.clientId,
    sourceSessionAt: row.session?.scheduledAt.toISOString(),
    text: row.text,
    speaker: row.speaker,
    followUp: row.followUp,
    createdAt: row.createdAt.toISOString(),
    revision: row.revision ?? 0,
    revisions: AgreementRevisionHistorySchema.parse(row.revisions ?? []),
    retiredAt: row.retiredAt?.toISOString() ?? null,
    retirementReason: row.retirementReason ?? null,
    homeworkAssignments: row.homeworkAssignments?.flatMap((assignment) =>
      assignment.sourceAgreementRevision === null
        ? []
        : [
            {
              ...assignment,
              sourceAgreementRevision: assignment.sourceAgreementRevision,
              dueAt: assignment.dueAt?.toISOString() ?? null,
            },
          ],
    ),
  };
}
