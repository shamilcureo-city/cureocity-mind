import { describe, expect, it } from 'vitest';
import {
  EffectiveCapabilitiesSchema,
  PractitionerCapabilityGrantSchema,
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

  it('normalizes credential evidence text and rejects whitespace-only values', () => {
    const baseCredential = {
      id: 'ccredaaaaaaaaaaaaaaaaaaaa',
      psychologistId: 'cpsyaaaaaaaaaaaaaaaaaaaaa',
      kind: 'NMC_REGISTRATION' as const,
      registrationNumber: '  NMC-12345  ',
      issuingAuthority: '  National Medical Commission  ',
      jurisdiction: '  IN  ',
      status: 'PENDING_VERIFICATION' as const,
      verifiedAt: null,
      expiresAt: null,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    };

    expect(PractitionerCredentialSchema.parse(baseCredential)).toMatchObject({
      registrationNumber: 'NMC-12345',
      issuingAuthority: 'National Medical Commission',
      jurisdiction: 'IN',
    });

    for (const field of ['registrationNumber', 'issuingAuthority', 'jurisdiction'] as const) {
      expect(() =>
        PractitionerCredentialSchema.parse({ ...baseCredential, [field]: '   ' }),
      ).toThrow();
    }
  });

  it('validates capability grants as first-class contracts', () => {
    const grant = PractitionerCapabilityGrantSchema.parse({
      id: 'cgrantaaaaaaaaaaaaaaaaaaa',
      psychologistId: 'cpsyaaaaaaaaaaaaaaaaaaaaa',
      capability: 'MEDICAL_DOCUMENTATION',
      source: 'VERIFIED_CREDENTIAL',
      active: true,
      grantedAt: '2026-08-12T00:00:00.000Z',
      revokedAt: null,
      metadata: { credentialKind: 'NMC_REGISTRATION' },
    });

    expect(grant.capability).toBe('MEDICAL_DOCUMENTATION');
    expect(grant.source).toBe('VERIFIED_CREDENTIAL');
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

  it('represents profession as unknown when no professional evidence exists', () => {
    const effective = EffectiveCapabilitiesSchema.parse({
      profession: null,
      capabilities: ['MEDICAL_DOCUMENTATION'],
      verifiedCredentialKinds: [],
    });

    expect(effective.profession).toBeNull();
  });
});
