import type {
  ClientStatus,
  PractitionerVertical,
  PractitionerProfession,
  SessionConsentSnapshot,
  SessionKind,
  SessionModality,
  SessionStatus,
} from '@cureocity/contracts';

declare const orbitId: unique symbol;
type OrbitId<Kind extends string> = string & { readonly [orbitId]: Kind };

export type PractitionerId = OrbitId<'PractitionerId'>;
export type PatientId = OrbitId<'PatientId'>;
export type EncounterId = OrbitId<'EncounterId'>;

/** Boundary-only constructors. Persistence adapters remain responsible for validating IDs. */
export const practitionerId = (value: string): PractitionerId => value as PractitionerId;
export const patientId = (value: string): PatientId => value as PatientId;
export const encounterId = (value: string): EncounterId => value as EncounterId;

export type EncounterProfile =
  | 'BEHAVIORAL_HEALTH_INTAKE'
  | 'BEHAVIORAL_HEALTH_FOLLOWUP'
  | 'BEHAVIORAL_HEALTH_REVIEW'
  | 'MEDICAL_CONSULT'
  | 'MEDICAL_FOLLOWUP';

export interface Practitioner {
  id: PractitionerId;
  firebaseUid: string;
  fullName: string;
  email: string;
  phone: string;
  profession: PractitionerProfession;
  legacyVertical: PractitionerVertical;
  registrationNumber: string;
  specialty: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';
  createdAt: string;
  updatedAt: string;
}

export interface Patient {
  id: PatientId;
  ownerPractitionerId: PractitionerId;
  fullName: string;
  contactPhone: string;
  contactEmail: string | null;
  dateOfBirth: string | null;
  preferredLanguage: string;
  spokenLanguages: string[];
  status: ClientStatus;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Encounter {
  id: EncounterId;
  patientId: PatientId;
  ownerPractitionerId: PractitionerId;
  profile: EncounterProfile;
  legacyKind: SessionKind;
  modality: SessionModality | null;
  status: SessionStatus;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  consentSnapshot: SessionConsentSnapshot | null;
  createdAt: string;
  updatedAt: string;
}
