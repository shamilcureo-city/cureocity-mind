import type {
  Booking as BookingRow,
  Client as ClientRow,
  IntakeSubmission as IntakeRow,
  ModalityState as ModalityStateRow,
  ModalityTransition as ModalityTransitionRow,
  NoteDraft as NoteDraftRow,
  Session as SessionRow,
} from '@prisma/client';
import type {
  AffectFeature,
  Client,
  ModalityState,
  ModalityStateWithHistory,
  ModalityTransition,
  NoteDraft,
  Session,
  SpeakerSegment,
  TherapyNoteV1,
  WorkflowGoal,
} from '@cureocity/contracts';

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

export function toNoteDraft(row: NoteDraftRow): NoteDraft {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    transcript: row.transcript,
    speakerSegments:
      row.speakerSegments === null
        ? null
        : (row.speakerSegments as unknown as SpeakerSegment[]),
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

export function toModalityTransition(row: ModalityTransitionRow): ModalityTransition {
  return {
    id: row.id,
    stateId: row.stateId,
    fromPhase: row.fromPhase,
    toPhase: row.toPhase,
    trigger: row.trigger,
    reason: row.reason,
    psychologistId: row.psychologistId,
    evidence: (row.evidence as Record<string, unknown> | null) ?? null,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function toModalityState(row: ModalityStateRow): ModalityState {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    modality: row.modality,
    currentPhase: row.currentPhase,
    state: (row.state as Record<string, unknown>) ?? {},
    goals: (row.goals as WorkflowGoal[]) ?? [],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toModalityStateWithHistory(
  row: ModalityStateRow & { transitions: ModalityTransitionRow[] },
): ModalityStateWithHistory {
  return {
    ...toModalityState(row),
    transitions: row.transitions.map(toModalityTransition),
  };
}
