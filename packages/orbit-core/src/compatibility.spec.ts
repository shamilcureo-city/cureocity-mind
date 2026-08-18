import { ClientSchema, PsychologistSchema, SessionSchema } from '@cureocity/contracts';
import { describe, expect, it } from 'vitest';
import {
  legacyEncounterProfile,
  mapClientToPatient,
  mapPsychologistToPractitioner,
  mapSessionToEncounter,
} from './compatibility';

const now = '2026-08-12T10:00:00.000Z';

const psychologistFixture = (overrides: Record<string, unknown> = {}) =>
  PsychologistSchema.parse({
    id: 'cpsyfffffffffffffffffffff',
    firebaseUid: 'firebase-fixture',
    email: 'fixture@example.com',
    fullName: 'Fixture Practitioner',
    phone: '+919****3299',
    rciNumber: 'RCI-FIXTURE',
    rciVerifiedAt: null,
    status: 'ACTIVE',
    role: 'THERAPIST',
    vertical: 'THERAPIST',
    profession: null,
    medicalRegNumber: null,
    specialty: null,
    headline: null,
    bio: null,
    photoUrl: null,
    specialties: [],
    languages: ['English'],
    modalities: [],
    yearsOfExperience: 0,
    locationCity: null,
    locationProvince: null,
    sessionFeeInr: null,
    isAcceptingNewClients: false,
    defaultOutputLanguage: 'en',
    defaultModality: null,
    backupEmail: null,
    onboardingCompletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

describe('ORBIT legacy compatibility adapters', () => {
  it('maps a therapist account to a canonical practitioner without changing its identity', () => {
    const legacy = PsychologistSchema.parse({
      id: 'cpsyaaaaaaaaaaaaaaaaaaaaa',
      firebaseUid: 'firebase-1',
      email: 'clinician@example.com',
      fullName: 'Dr Asha Rao',
      phone: '+919876543210',
      rciNumber: 'A12345',
      rciVerifiedAt: now,
      status: 'ACTIVE',
      role: 'THERAPIST',
      vertical: 'THERAPIST',
      medicalRegNumber: null,
      specialty: null,
      headline: null,
      bio: null,
      photoUrl: null,
      specialties: [],
      languages: ['English'],
      modalities: ['CBT'],
      yearsOfExperience: 8,
      locationCity: 'Kochi',
      locationProvince: 'Kerala',
      sessionFeeInr: 1800,
      isAcceptingNewClients: true,
      defaultOutputLanguage: 'en',
      defaultModality: 'CBT',
      backupEmail: null,
      onboardingCompletedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const practitioner = mapPsychologistToPractitioner(legacy);

    expect(practitioner).toMatchObject({
      id: legacy.id,
      profession: 'PSYCHOLOGIST',
      legacyVertical: 'THERAPIST',
      registrationNumber: 'A12345',
    });
  });

  it('uses verified RCI evidence independently of the legacy product vertical', () => {
    const practitioner = mapPsychologistToPractitioner(
      psychologistFixture({ vertical: 'DOCTOR', rciVerifiedAt: now }),
    );

    expect(practitioner).toMatchObject({
      profession: 'PSYCHOLOGIST',
      registrationNumber: 'RCI-FIXTURE',
    });
  });

  it('rejects RCI evidence with a future verification timestamp', () => {
    const practitioner = mapPsychologistToPractitioner(
      psychologistFixture({ rciVerifiedAt: '2999-01-01T00:00:00.000Z' }),
    );

    expect(practitioner).toMatchObject({
      profession: null,
      registrationNumber: null,
    });
  });

  it('rejects blank RCI registration evidence', () => {
    const practitioner = mapPsychologistToPractitioner(
      psychologistFixture({ rciNumber: '   ', rciVerifiedAt: now }),
    );

    expect(practitioner).toMatchObject({
      profession: null,
      registrationNumber: null,
    });
  });

  it('does not promote an unverified legacy medical registration into professional evidence', () => {
    const legacy = PsychologistSchema.parse({
      id: 'cpsybbbbbbbbbbbbbbbbbbbbb',
      firebaseUid: 'firebase-2',
      email: 'doctor@example.com',
      fullName: 'Dr Dev Shah',
      phone: '+919876543211',
      rciNumber: 'D00000',
      rciVerifiedAt: null,
      status: 'ACTIVE',
      role: 'THERAPIST',
      vertical: 'DOCTOR',
      medicalRegNumber: 'KMC-12345',
      specialty: 'Cardiology',
      headline: null,
      bio: null,
      photoUrl: null,
      specialties: ['Cardiology'],
      languages: ['English'],
      modalities: [],
      yearsOfExperience: 12,
      locationCity: 'Bengaluru',
      locationProvince: 'Karnataka',
      sessionFeeInr: 1200,
      isAcceptingNewClients: true,
      defaultOutputLanguage: 'en',
      defaultModality: null,
      backupEmail: null,
      onboardingCompletedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    expect(mapPsychologistToPractitioner(legacy)).toMatchObject({
      profession: null,
      registrationNumber: null,
      specialty: 'Cardiology',
    });
  });

  it('does not trust a regulated configured profession without qualifying evidence', () => {
    const practitioner = mapPsychologistToPractitioner(
      psychologistFixture({
        vertical: 'DOCTOR',
        profession: 'PHYSICIAN',
        medicalRegNumber: 'KMC-12345',
      }),
    );

    expect(practitioner).toMatchObject({
      profession: null,
      registrationNumber: null,
    });
  });

  it('preserves unknown profession when a doctor vertical has no medical registration', () => {
    const legacy = PsychologistSchema.parse({
      id: 'cpsyddddddddddddddddddddd',
      firebaseUid: 'firebase-4',
      email: 'unverified-doctor@example.com',
      fullName: 'Dev Shah',
      phone: '+919****3212',
      rciNumber: 'LEGACY-PLACEHOLDER',
      rciVerifiedAt: null,
      status: 'PENDING_VERIFICATION',
      role: 'THERAPIST',
      vertical: 'DOCTOR',
      medicalRegNumber: null,
      specialty: null,
      headline: null,
      bio: null,
      photoUrl: null,
      specialties: [],
      languages: ['English'],
      modalities: [],
      yearsOfExperience: 0,
      locationCity: null,
      locationProvince: null,
      sessionFeeInr: null,
      isAcceptingNewClients: false,
      defaultOutputLanguage: 'en',
      defaultModality: null,
      backupEmail: null,
      onboardingCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(mapPsychologistToPractitioner(legacy)).toMatchObject({
      profession: null,
      registrationNumber: null,
    });
  });

  it('preserves unknown profession when a therapist vertical has no verified evidence', () => {
    const legacy = PsychologistSchema.parse({
      id: 'cpsyttttttttttttttttttttt',
      firebaseUid: 'firebase-5',
      email: 'unverified-therapist@example.com',
      fullName: 'Asha Rao',
      phone: '+919****3213',
      rciNumber: 'LEGACY-PLACEHOLDER',
      rciVerifiedAt: null,
      status: 'PENDING_VERIFICATION',
      role: 'THERAPIST',
      vertical: 'THERAPIST',
      medicalRegNumber: null,
      specialty: null,
      headline: null,
      bio: null,
      photoUrl: null,
      specialties: [],
      languages: ['English'],
      modalities: [],
      yearsOfExperience: 0,
      locationCity: null,
      locationProvince: null,
      sessionFeeInr: null,
      isAcceptingNewClients: false,
      defaultOutputLanguage: 'en',
      defaultModality: null,
      backupEmail: null,
      onboardingCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(mapPsychologistToPractitioner(legacy)).toMatchObject({
      profession: null,
      registrationNumber: null,
    });
  });

  it('maps a client to one patient record and does not alias language arrays', () => {
    const legacy = ClientSchema.parse({
      id: 'cclient11111111111111111x',
      psychologistId: 'cpsyaaaaaaaaaaaaaaaaaaaaa',
      fullName: 'Arjun Rao',
      contactPhone: '+919812345678',
      contactEmail: 'arjun@example.com',
      dateOfBirth: '1990-01-02',
      presentingConcerns: 'Anxiety',
      preferredModality: 'CBT',
      preferredLanguage: 'ml',
      spokenLanguages: ['ml', 'en'],
      status: 'ACTIVE',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });

    const patient = mapClientToPatient(legacy);
    patient.spokenLanguages.push('hi');

    expect(patient.ownerPractitionerId).toBe(legacy.psychologistId);
    expect(legacy.spokenLanguages).toEqual(['ml', 'en']);
  });

  it('maps legacy session kinds to workflow-specific encounter profiles', () => {
    const legacy = SessionSchema.parse({
      id: 'csess11111111111111111111',
      clientId: 'cclient11111111111111111x',
      psychologistId: 'cpsyaaaaaaaaaaaaaaaaaaaaa',
      modality: null,
      kind: 'INTAKE',
      status: 'SCHEDULED',
      scheduledAt: now,
      startedAt: null,
      endedAt: null,
      consentSnapshot: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(mapSessionToEncounter(legacy, 'THERAPIST').profile).toBe('BEHAVIORAL_HEALTH_INTAKE');
    expect(mapSessionToEncounter(legacy, 'DOCTOR').profile).toBe('MEDICAL_CONSULT');
    expect(legacyEncounterProfile('REVIEW', 'DOCTOR')).toBe('MEDICAL_FOLLOWUP');
  });
});
