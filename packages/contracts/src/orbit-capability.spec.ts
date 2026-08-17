import { describe, expect, it } from 'vitest';
import {
  EffectiveCapabilitiesSchema,
  PractitionerCapabilitySchema,
  PractitionerCredentialSchema,
} from './orbit-capability';

describe('ORBIT capability contracts', () => {
  it('keeps prescription drafting and signing as distinct capabilities', () => {
    expect(PractitionerCapabilitySchema.options).toContain('PRESCRIPTION_DRAFTING');
    expect(PractitionerCapabilitySchema.options).toContain('PRESCRIPTION_SIGNING');
  });

  it('requires credential verification state and jurisdiction', () => {
    const credential = PractitionerCredentialSchema.parse({
      id: 'ccredaaaaaaaaaaaaaaaaaaaa',
      psychologistId: 'cpsyaaaaaaaaaaaaaaaaaaaaa',
      kind: 'NMC_REGISTRATION',
      registrationNumber: 'NMC-12345',
      issuingAuthority: 'National Medical Commission',
      status: 'VERIFIED',
      verifiedAt: '2026-08-12T00:00:00.000Z',
      expiresAt: null,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(credential.jurisdiction).toBe('IN');
  });

  it('supports a mixed-capability psychiatrist', () => {
    const effective = EffectiveCapabilitiesSchema.parse({
      profession: 'PSYCHIATRIST',
      capabilities: [
        'BEHAVIORAL_HEALTH_DOCUMENTATION',
        'MEDICAL_DOCUMENTATION',
        'MEASUREMENT_BASED_CARE',
        'PRESCRIPTION_DRAFTING',
        'PRESCRIPTION_SIGNING',
      ],
      verifiedCredentialKinds: ['NMC_REGISTRATION'],
    });
    expect(effective.capabilities).toContain('BEHAVIORAL_HEALTH_DOCUMENTATION');
    expect(effective.capabilities).toContain('MEDICAL_DOCUMENTATION');
  });
});
