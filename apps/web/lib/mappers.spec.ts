import { describe, expect, it } from 'vitest';
import { toPsychologist } from './mappers';

describe('practitioner mapper', () => {
  it('exposes the configured profession used by capability-aware clients', () => {
    const date = new Date('2026-08-18T00:00:00.000Z');
    const row = {
      id: 'psy-1',
      firebaseUid: 'uid',
      email: 'doctor@example.test',
      fullName: 'Doctor',
      phone: '+910000000000',
      rciNumber: '',
      rciVerifiedAt: null,
      status: 'ACTIVE',
      role: 'THERAPIST',
      vertical: 'DOCTOR',
      profession: 'PHYSICIAN',
      medicalRegNumber: null,
      specialty: null,
      headline: null,
      bio: null,
      photoUrl: null,
      specialties: [],
      languages: [],
      modalities: [],
      yearsOfExperience: null,
      locationCity: null,
      locationProvince: null,
      sessionFeeInr: null,
      isAcceptingNewClients: false,
      defaultOutputLanguage: 'en',
      defaultModality: null,
      defaultCaptureMode: null,
      clinicName: null,
      clinicAddress: null,
      clinicPhone: null,
      backupEmail: null,
      onboardingCompletedAt: null,
      deletedAt: null,
      createdAt: date,
      updatedAt: date,
    } as never;

    expect(toPsychologist(row).profession).toBe('PHYSICIAN');
  });
});
