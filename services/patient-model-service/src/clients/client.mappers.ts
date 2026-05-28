import type {
  Client as ClientRow,
  Consent as ConsentRow,
  Session as SessionRow,
} from '@prisma/client';
import type { Client, Consent, BriefingSessionSummary } from '@cureocity/contracts';

function toIsoDate(d: Date | null): string | null {
  if (d === null) return null;
  return d.toISOString().slice(0, 10);
}

export function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    psychologistId: row.psychologistId,
    fullName: row.fullName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    dateOfBirth: toIsoDate(row.dateOfBirth),
    presentingConcerns: row.presentingConcerns,
    preferredModality: row.preferredModality as Client['preferredModality'],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    scope: row.scope,
    status: row.status,
    scriptVersion: row.scriptVersion,
    capturedVia: row.capturedVia,
    grantedAt: row.grantedAt.toISOString(),
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toBriefingSessionSummary(row: SessionRow): BriefingSessionSummary {
  return {
    id: row.id,
    modality: row.modality,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
