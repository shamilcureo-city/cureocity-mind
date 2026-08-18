import { ClientSchema, PsychologistSchema, SessionSchema } from '@cureocity/contracts';
import { describe, expect, it } from 'vitest';
import {
  legacyEncounterProfile,
  mapClientToPatient,
  mapPsychologistToPractitioner,
  mapSessionToEncounter,
} from './compatibility';

const now = '2026-08-12T10:00:00.000Z';

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

  it('maps a doctor registration into the canonical practitioner shape', () => {
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
      profession: 'PHYSICIAN',
      registrationNumber: 'KMC-12345',
      specialty: 'Cardiology',
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
