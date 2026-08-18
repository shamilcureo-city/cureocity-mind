export type DpdpErasureDisposition = 'DELETE' | 'REDACT' | 'RETAIN_LEGAL_PROOF' | 'RETAIN_NON_PHI';

export interface DpdpErasureManifestEntry {
  readonly disposition: DpdpErasureDisposition;
  readonly operation: string;
  readonly retentionClass: string;
}

const clinicalDelete = (operation: string): DpdpErasureManifestEntry => ({
  disposition: 'DELETE',
  operation,
  retentionClass: 'ERASE_ON_FULFILMENT',
});
const redact = (operation: string): DpdpErasureManifestEntry => ({
  disposition: 'REDACT',
  operation,
  retentionClass: 'DEIDENTIFIED_OPERATIONAL_RECORD',
});
const legalProof = (
  operation: string,
  retentionClass = 'CLINICAL_ATTESTATION_PROOF',
): DpdpErasureManifestEntry => ({
  disposition: 'RETAIN_LEGAL_PROOF',
  operation,
  retentionClass,
});

/**
 * Schema-reviewed DPDP erasure inventory.
 *
 * This is an engineering control, not a legal opinion. The schema-completeness
 * test derives the client/session relation graph and exact scalar Client fields
 * from prisma/schema.prisma; additions fail until a reviewer chooses an explicit
 * disposition, operation and retention class here.
 */
export const CLIENT_FIELD_ERASURE_MANIFEST = {
  clientFirebaseUid: 'REDACT',
  dateOfBirth: 'REDACT',
  contactPhoneEncrypted: 'REDACT',
  contactEmailEncrypted: 'REDACT',
  fullNameEncrypted: 'REDACT',
  presentingConcerns: 'REDACT',
  preferredModality: 'REDACT',
  allergies: 'REDACT',
  carriedQuestions: 'REDACT',
  abhaAddress: 'REDACT',
  preferredLanguage: 'REDACT',
  spokenLanguages: 'REDACT',
} as const satisfies Record<string, DpdpErasureDisposition>;

export const DPDP_ERASURE_MANIFEST = {
  ClientNomination: clinicalDelete('delete nominee identity, contact details and notes'),
  ClientErasureRequest: legalProof(
    'retain status/timestamps; replace reason and resolution free text with SHA-256 hashes',
    'SECURITY_AND_DSR_PROOF',
  ),
  ErasureObjectDeletionTask: legalProof(
    'retain pending object key only until deletion; then clear key and retain hash/status proof',
    'SECURITY_AND_DSR_PROOF',
  ),
  ClientGrievance: clinicalDelete('delete grievance subject, body and resolution notes'),
  ClientPushSubscription: clinicalDelete('delete push endpoint and authentication credentials'),
  ClientClaimToken: clinicalDelete('delete claim token and redeemed Firebase UID'),
  Consent: legalProof(
    'retain scope/status/script/channel/timestamps; redact consent notes',
    'CONSENT_PROOF',
  ),
  Session: legalProof(
    'retain the minimal signed-record parent; clear modality, language, phase and consent snapshots',
  ),
  AudioChunk: clinicalDelete(
    'enqueue every s3Key in the object-deletion outbox, then delete database audio rows',
  ),
  TranscriptSegment: clinicalDelete('delete transcript, diarization and affect artifacts'),
  GeminiCallLog: clinicalDelete('delete session-linked model logs and bounded error details'),
  NoteDraft: redact('retain signed-note FK parent; clear transcript, content, Rx and errors'),
  TherapyNote: legalProof(
    'retain hashes/timestamps/actor; redact content, Rx, payload and credentials',
  ),
  NoteEdit: clinicalDelete('delete before/after signed-note edit payloads'),
  NoteSignatureVersion: legalProof(
    'retain content hash/timestamps/actor; redact versioned content, Rx, payload and credentials',
  ),
  MedicationOrder: clinicalDelete('delete medication content and confirmation history'),
  ClinicalOrder: clinicalDelete('delete clinical order content and confirmation history'),
  Differential: clinicalDelete('delete differential body and errors'),
  ClinicalReading: clinicalDelete('delete chronic and vital readings'),
  ClinicalReport: clinicalDelete('delete clinical analysis, confirmations and errors'),
  ClientDiagnosis: clinicalDelete('delete diagnoses, evidence and notes'),
  TreatmentPlan: clinicalDelete('delete treatment plan body and confirmation history'),
  TreatmentGoalProgress: clinicalDelete('delete goal-progress artifacts before treatment plans'),
  CaseFormulation: clinicalDelete('delete formulation body and provenance'),
  SessionAgreement: clinicalDelete('delete carried agreement text and follow-up'),
  TreatmentEpisode: clinicalDelete('delete episode outcome and close reason'),
  AssessmentItem: clinicalDelete('delete assessment question, rationale and resolution'),
  PatientShare: clinicalDelete('delete snapshots, recipient, token and provider/error details'),
  TherapyScript: clinicalDelete('delete generated therapy scripts and cache linkage'),
  PreSessionBrief: clinicalDelete('delete pre-session brief body and errors'),
  CaseConsult: clinicalDelete('delete case consultation body and errors'),
  ClientConceptualMap: clinicalDelete('delete conceptual map and source-session list'),
  InstrumentResponse: clinicalDelete('delete assessment responses, score and notes'),
  SafetyPlan: clinicalDelete('delete safety-plan body and confirmation history'),
  ExerciseAssignment: clinicalDelete('delete assignment response, description and therapist note'),
  MoodLog: clinicalDelete('delete mood rating and notes'),
  JournalEntry: clinicalDelete('delete plaintext/encrypted journal content and metadata'),
  ModalityState: clinicalDelete('delete modality phase, goals and state'),
  ModalityTransition: clinicalDelete(
    'delete transition reasons and evidence before modality state',
  ),
  EmdrTarget: clinicalDelete('delete EMDR target imagery, cognitions, body location and notes'),
  SessionProblemLink: clinicalDelete('delete session/problem linkage before either parent'),
  NoteReview: clinicalDelete('delete reviewer list and review timestamps'),
  LiveConsultMetric: clinicalDelete('delete per-consult latency and quality measurements'),
  Letter: clinicalDelete('delete clinical letter recipient, subject and body'),
  ProblemListItem: clinicalDelete('delete problem title, detail and status history'),
  Appointment: redact('unlink client/session and redact patient identity and concern'),
  AuditLog: legalProof(
    'retain append-only event proof; remove/hash PHI-bearing metadata and retain bounded codes/IDs',
    'SECURITY_AND_DSR_PROOF',
  ),
} as const satisfies Record<string, DpdpErasureManifestEntry>;
