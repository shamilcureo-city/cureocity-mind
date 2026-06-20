import type {
  Booking as BookingRow,
  Client as ClientRow,
  ExerciseAssignment as ExerciseAssignmentRow,
  IntakeSubmission as IntakeRow,
  ModalityState as ModalityStateRow,
  ModalityTransition as ModalityTransitionRow,
  NoteDraft as NoteDraftRow,
  NoteTemplate as NoteTemplateRow,
  Psychologist as PsychologistRow,
  Session as SessionRow,
  WebAuthnCredential as WebAuthnCredentialRow,
} from '@prisma/client';
import type {
  AffectFeature,
  Client,
  ExerciseAssignment,
  ModalityState,
  ModalityStateWithHistory,
  ModalityTransition,
  NoteDraft,
  NoteTemplate,
  Psychologist,
  Session,
  SessionModality,
  SpeakerSegment,
  TemplateSection,
  TherapyNoteV1,
  WebAuthnCredential,
  WebAuthnTransport,
  WorkflowGoal,
} from '@cureocity/contracts';
import { resolveClientPii } from '@/lib/client-pii';

/**
 * Prisma row → DTO mappers. Single source of truth for what crosses
 * the API boundary; adding a column that should NOT be exposed means
 * editing the mapper here.
 */

function toIsoDate(d: Date | null): string | null {
  return d === null ? null : d.toISOString().slice(0, 10);
}

/**
 * Sprint 32 / 54 — async because PII is read-cut-over: the name + contact
 * are decrypted from the envelope-encrypted columns (falling back to the
 * plaintext twins for rows not yet backfilled). See `lib/client-pii.ts`.
 */
export async function toClient(row: ClientRow): Promise<Client> {
  const pii = await resolveClientPii(row);
  return {
    id: row.id,
    psychologistId: row.psychologistId,
    fullName: pii.fullName,
    contactPhone: pii.contactPhone,
    contactEmail: pii.contactEmail,
    dateOfBirth: toIsoDate(row.dateOfBirth),
    presentingConcerns: row.presentingConcerns,
    preferredModality: row.preferredModality as Client['preferredModality'],
    preferredLanguage: row.preferredLanguage,
    spokenLanguages: row.spokenLanguages,
    status: row.status,
    isDemo: row.isDemo,
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

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    modality: row.modality,
    // Sprint 19 — session classification (INTAKE / TREATMENT / REVIEW).
    kind: row.kind,
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

export function toExerciseAssignment(row: ExerciseAssignmentRow): ExerciseAssignment {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    exerciseId: row.exerciseId,
    // Sprint 51 — provenance fields.
    source: row.source,
    customDescription: row.customDescription,
    sourceTherapyScriptId: row.sourceTherapyScriptId,
    assignedAt: row.assignedAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    response: (row.response as Record<string, unknown> | null) ?? null,
    therapistNote: row.therapistNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toNoteTemplate(row: NoteTemplateRow): NoteTemplate {
  return {
    id: row.id,
    psychologistId: row.psychologistId,
    name: row.name,
    description: row.description,
    sections: (row.sections as unknown as TemplateSection[]) ?? [],
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const VALID_TRANSPORTS = new Set<WebAuthnTransport>(['usb', 'nfc', 'ble', 'internal', 'hybrid']);

export function toPsychologist(row: PsychologistRow): Psychologist {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    rciNumber: row.rciNumber,
    rciVerifiedAt: row.rciVerifiedAt?.toISOString() ?? null,
    status: row.status,
    role: row.role,
    vertical: row.vertical,
    medicalRegNumber: row.medicalRegNumber,
    specialty: row.specialty,
    headline: row.headline,
    bio: row.bio,
    photoUrl: row.photoUrl,
    specialties: row.specialties,
    languages: row.languages,
    modalities: row.modalities,
    yearsOfExperience: row.yearsOfExperience,
    locationCity: row.locationCity,
    locationProvince: row.locationProvince,
    sessionFeeInr: row.sessionFeeInr,
    isAcceptingNewClients: row.isAcceptingNewClients,
    defaultOutputLanguage: row.defaultOutputLanguage,
    defaultModality: (row.defaultModality as SessionModality | null) ?? null,
    backupEmail: row.backupEmail,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWebAuthnCredential(row: WebAuthnCredentialRow): WebAuthnCredential {
  return {
    id: row.id,
    psychologistId: row.psychologistId,
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    signCount: row.signCount,
    transports: row.transports.filter((t): t is WebAuthnTransport =>
      VALID_TRANSPORTS.has(t as WebAuthnTransport),
    ),
    label: row.label,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
