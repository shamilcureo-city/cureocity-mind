import type { Client, PractitionerVertical, Psychologist, Session } from '@cureocity/contracts';
import {
  encounterId,
  patientId,
  practitionerId,
  type Encounter,
  type EncounterProfile,
  type Patient,
  type Practitioner,
} from './domain';

/** Maps only explicit legacy professional evidence; a product vertical is not a profession. */
export function mapPsychologistToPractitioner(row: Psychologist): Practitioner {
  const rciVerifiedAt = row.rciVerifiedAt ? new Date(row.rciVerifiedAt) : null;
  const rciRegistrationNumber = row.rciNumber.trim();
  const hasVerifiedRciEvidence =
    rciRegistrationNumber.length > 0 &&
    rciVerifiedAt !== null &&
    Number.isFinite(rciVerifiedAt.getTime()) &&
    rciVerifiedAt.getTime() <= Date.now();
  const registrationNumber = hasVerifiedRciEvidence ? rciRegistrationNumber : null;
  const profession =
    row.profession === 'COUNSELLOR'
      ? 'COUNSELLOR'
      : hasVerifiedRciEvidence && (row.profession === null || row.profession === 'PSYCHOLOGIST')
        ? 'PSYCHOLOGIST'
        : null;
  return {
    id: practitionerId(row.id),
    firebaseUid: row.firebaseUid,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    profession,
    legacyVertical: row.vertical,
    registrationNumber,
    specialty: row.specialty,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapClientToPatient(row: Client): Patient {
  return {
    id: patientId(row.id),
    ownerPractitionerId: practitionerId(row.psychologistId),
    fullName: row.fullName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    dateOfBirth: row.dateOfBirth,
    preferredLanguage: row.preferredLanguage,
    spokenLanguages: [...row.spokenLanguages],
    status: row.status,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapSessionToEncounter(
  row: Session,
  practitionerVertical: PractitionerVertical,
): Encounter {
  return {
    id: encounterId(row.id),
    patientId: patientId(row.clientId),
    ownerPractitionerId: practitionerId(row.psychologistId),
    profile: legacyEncounterProfile(row.kind, practitionerVertical),
    legacyKind: row.kind,
    modality: row.modality,
    status: row.status,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    consentSnapshot: row.consentSnapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function legacyEncounterProfile(
  kind: Session['kind'],
  vertical: PractitionerVertical,
): EncounterProfile {
  if (vertical === 'DOCTOR') {
    return kind === 'REVIEW' ? 'MEDICAL_FOLLOWUP' : 'MEDICAL_CONSULT';
  }
  if (kind === 'INTAKE') return 'BEHAVIORAL_HEALTH_INTAKE';
  if (kind === 'REVIEW') return 'BEHAVIORAL_HEALTH_REVIEW';
  return 'BEHAVIORAL_HEALTH_FOLLOWUP';
}
