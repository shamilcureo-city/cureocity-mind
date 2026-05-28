import type {
  Client as ClientRow,
  Consent as ConsentRow,
  ExerciseAssignment as ExerciseAssignmentRow,
  JournalEntry as JournalEntryRow,
  MoodLog as MoodLogRow,
  NoteDraft as NoteDraftRow,
  Session as SessionRow,
} from '@prisma/client';
import type {
  AffectFeature,
  BriefingSessionSummary,
  Client,
  Consent,
  ExerciseAssignment,
  JournalEntry,
  MoodLog,
  NoteDraft,
  Session,
  SessionConsentSnapshot,
  SpeakerSegment,
  TherapyNoteV1,
} from '@cureocity/contracts';

/**
 * Prisma row → contract DTO mappers, ported from the NestJS services.
 * Single source of truth for the BFF — adding a column to a Prisma
 * row that should NOT cross the wire means editing one mapper here.
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
        : (row.consentSnapshot as unknown as SessionConsentSnapshot),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toNoteDraft(row: NoteDraftRow): NoteDraft {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    transcript: row.transcript,
    speakerSegments:
      row.speakerSegments === null ? null : (row.speakerSegments as unknown as SpeakerSegment[]),
    affectFeatures:
      row.affectFeatures === null ? null : (row.affectFeatures as unknown as AffectFeature[]),
    content: row.content === null ? null : (row.content as unknown as TherapyNoteV1),
    riskSeverity: row.riskSeverity,
    totalCostInr: row.totalCostInr.toString(),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toExerciseAssignment(row: ExerciseAssignmentRow): ExerciseAssignment {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    exerciseId: row.exerciseId,
    assignedAt: row.assignedAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    response:
      row.response === null || typeof row.response !== 'object' || Array.isArray(row.response)
        ? null
        : (row.response as Record<string, unknown>),
    therapistNote: row.therapistNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMoodLog(row: MoodLogRow): MoodLog {
  return {
    id: row.id,
    clientId: row.clientId,
    rating: row.rating,
    notes: row.notes,
    recordedAt: row.recordedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toJournalEntry(row: JournalEntryRow): JournalEntry {
  return {
    id: row.id,
    clientId: row.clientId,
    content: row.content,
    mood: row.mood,
    sharedWithTherapist: row.sharedWithTherapist,
    recordedAt: row.recordedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
