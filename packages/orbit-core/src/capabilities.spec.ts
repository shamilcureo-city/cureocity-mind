import { describe, expect, it } from 'vitest';
import { resolveEffectiveCapabilities } from './capabilities';

const active = (
  capability: Parameters<typeof resolveEffectiveCapabilities>[0]['grants'][number]['capability'],
) => ({
  capability,
  source: 'LEGACY_BACKFILL' as const,
  active: true,
  revokedAt: null,
});

describe('effective ORBIT capability resolution', () => {
  it('never grants prescription signing from a legacy doctor vertical alone', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'DOCTOR',
      grants: [active('MEDICAL_DOCUMENTATION'), active('PRESCRIPTION_DRAFTING')],
      credentials: [],
    });
    expect(result.capabilities.has('PRESCRIPTION_DRAFTING')).toBe(true);
    expect(result.capabilities.has('PRESCRIPTION_SIGNING')).toBe(false);
  });

  it('does not infer a profession from a legacy doctor vertical alone', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'DOCTOR',
      grants: [active('MEDICAL_DOCUMENTATION')],
      credentials: [],
    });

    expect(result.profession).toBeNull();
  });

  it('grants prescription signing only with an active verified medical credential', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'DOCTOR',
      grants: [active('MEDICAL_DOCUMENTATION'), active('PRESCRIPTION_DRAFTING')],
      credentials: [
        {
          kind: 'NMC_REGISTRATION',
          status: 'VERIFIED',
          jurisdiction: 'IN',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2027-01-01T00:00:00.000Z',
        },
      ],
      now: new Date('2026-08-12T00:00:00.000Z'),
    });
    expect(result.capabilities.has('PRESCRIPTION_SIGNING')).toBe(true);
  });

  it('rejects expired, suspended, and revoked authority', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'DOCTOR',
      grants: [
        active('PRESCRIPTION_DRAFTING'),
        { ...active('CLINICAL_ORDERS'), active: false, revokedAt: '2026-01-01T00:00:00.000Z' },
      ],
      credentials: [
        {
          kind: 'NMC_REGISTRATION',
          status: 'VERIFIED',
          jurisdiction: 'IN',
          verifiedAt: '2025-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      now: new Date('2026-08-12T00:00:00.000Z'),
    });
    expect(result.capabilities.has('PRESCRIPTION_SIGNING')).toBe(false);
    expect(result.capabilities.has('CLINICAL_ORDERS')).toBe(false);
  });

  it('does not use an out-of-jurisdiction credential for signing authority', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'DOCTOR',
      grants: [active('PRESCRIPTION_DRAFTING')],
      credentials: [
        {
          kind: 'NMC_REGISTRATION',
          status: 'VERIFIED',
          jurisdiction: 'US',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
        },
      ],
    });
    expect(result.capabilities.has('PRESCRIPTION_SIGNING')).toBe(false);
  });

  it('rejects a credential with a malformed verification timestamp', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'DOCTOR',
      grants: [active('PRESCRIPTION_DRAFTING')],
      credentials: [
        {
          kind: 'NMC_REGISTRATION',
          status: 'VERIFIED',
          jurisdiction: 'IN',
          verifiedAt: 'not-a-date',
          expiresAt: null,
        },
      ],
      now: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(result.capabilities.has('PRESCRIPTION_SIGNING')).toBe(false);
  });

  it('rejects a credential verified in the future', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'DOCTOR',
      grants: [active('PRESCRIPTION_DRAFTING')],
      credentials: [
        {
          kind: 'NMC_REGISTRATION',
          status: 'VERIFIED',
          jurisdiction: 'IN',
          verifiedAt: '2026-08-13T00:00:00.000Z',
          expiresAt: null,
        },
      ],
      now: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(result.capabilities.has('PRESCRIPTION_SIGNING')).toBe(false);
  });

  it('resolves mixed behavioral and medical authority as psychiatry', () => {
    const result = resolveEffectiveCapabilities({
      legacyVertical: 'THERAPIST',
      grants: [active('BEHAVIORAL_HEALTH_DOCUMENTATION'), active('MEDICAL_DOCUMENTATION')],
      credentials: [
        {
          kind: 'STATE_MEDICAL_COUNCIL_REGISTRATION',
          status: 'VERIFIED',
          jurisdiction: 'IN',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
        },
      ],
    });
    expect(result.profession).toBe('PSYCHIATRIST');
  });
});
