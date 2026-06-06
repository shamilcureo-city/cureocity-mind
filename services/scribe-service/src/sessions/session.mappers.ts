import type { Session as SessionRow } from '@prisma/client';
import type { Session, SessionConsentSnapshot } from '@cureocity/contracts';

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    modality: row.modality,
    kind: row.kind,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    consentSnapshot:
      row.consentSnapshot === null
        ? null
        : (row.consentSnapshot as unknown as SessionConsentSnapshot),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
