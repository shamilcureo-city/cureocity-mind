import type {
  Booking as BookingRow,
  Client as ClientRow,
  IntakeSubmission as IntakeRow,
  Session as SessionRow,
} from '@prisma/client';
import type { Client, Session } from '@cureocity/contracts';

/**
 * Prisma row → DTO mappers. Single source of truth for what crosses
 * the API boundary; adding a column that should NOT be exposed means
 * editing the mapper here.
 */

function toIsoDate(d: Date | null): string | null {
  return d === null ? null : d.toISOString().slice(0, 10);
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

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    modality: row.modality,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    consentSnapshot:
      row.consentSnapshot === null
        ? null
        : (row.consentSnapshot as unknown as Session['consentSnapshot']),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface BookingDto {
  id: string;
  therapistId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  preferredAt: string;
  message: string | null;
  status: BookingRow['status'];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export function toBooking(row: BookingRow): BookingDto {
  return {
    id: row.id,
    therapistId: row.therapistId,
    patientName: row.patientName,
    patientEmail: row.patientEmail,
    patientPhone: row.patientPhone,
    preferredAt: row.preferredAt.toISOString(),
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export interface IntakeDto {
  id: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  concerns: string[];
  notes: string | null;
  preferredModality: string | null;
  preferredLanguage: string | null;
  mode: IntakeRow['mode'];
  urgency: IntakeRow['urgency'];
  status: IntakeRow['status'];
  assignedTherapistId: string | null;
  createdAt: string;
  updatedAt: string;
  matchedAt: string | null;
}

export function toIntake(row: IntakeRow): IntakeDto {
  return {
    id: row.id,
    patientName: row.patientName,
    patientEmail: row.patientEmail,
    patientPhone: row.patientPhone,
    concerns: row.concerns,
    notes: row.notes,
    preferredModality: row.preferredModality,
    preferredLanguage: row.preferredLanguage,
    mode: row.mode,
    urgency: row.urgency,
    status: row.status,
    assignedTherapistId: row.assignedTherapistId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    matchedAt: row.matchedAt?.toISOString() ?? null,
  };
}
