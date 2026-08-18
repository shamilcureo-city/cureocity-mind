import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findPsychologist: vi.fn(),
  findSession: vi.fn(),
  writeAudit: vi.fn(),
}));
vi.mock('./audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: mocks.findPsychologist },
    session: { findUnique: mocks.findSession },
  },
}));

import {
  assertAuditedSessionCapabilities,
  assertSessionCapabilities,
  getEffectiveCapabilities,
  serializeCapabilities,
} from './capabilities';

const originalDisabled = process.env['ORBIT_DISABLED_CAPABILITIES'];
afterEach(() => {
  if (originalDisabled === undefined) delete process.env['ORBIT_DISABLED_CAPABILITIES'];
  else process.env['ORBIT_DISABLED_CAPABILITIES'] = originalDisabled;
  vi.clearAllMocks();
});

const practitioner = (capabilityGrants: object[] = [], clinicMemberships: object[] = []) => ({
  vertical: 'DOCTOR',
  profession: 'PHYSICIAN',
  credentials: [],
  capabilityGrants,
  clinicMemberships,
});

describe('effective capability query', () => {
  it('combines active practitioner and clinic grants and serializes deterministically', async () => {
    mocks.findPsychologist.mockResolvedValue(
      practitioner(
        [
          {
            capability: 'CLINICAL_ORDERS',
            source: 'ADMIN_OVERRIDE',
            active: true,
            revokedAt: null,
          },
          {
            capability: 'FHIR_EXPORT',
            source: 'ADMIN_OVERRIDE',
            active: false,
            revokedAt: new Date(),
          },
        ],
        [
          {
            clinic: {
              capabilityGrants: [
                { capability: 'PRESCRIPTION_DRAFTING', active: true, revokedAt: null },
              ],
            },
          },
        ],
      ),
    );
    const effective = await getEffectiveCapabilities('psy-1');
    expect(serializeCapabilities(effective)).toEqual(['CLINICAL_ORDERS', 'PRESCRIPTION_DRAFTING']);
    expect(mocks.findPsychologist).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'psy-1' },
        select: expect.objectContaining({
          credentials: expect.objectContaining({
            where: expect.objectContaining({ status: 'VERIFIED', jurisdiction: 'IN' }),
          }),
          capabilityGrants: expect.objectContaining({
            where: { active: true, revokedAt: null },
          }),
        }),
      }),
    );
  });

  it('fails closed for optional FHIR and ABDM capabilities when grants are absent', async () => {
    mocks.findPsychologist.mockResolvedValue(practitioner());
    const effective = await getEffectiveCapabilities('psy-1');
    expect(effective.capabilities.has('FHIR_EXPORT')).toBe(false);
    expect(effective.capabilities.has('ABDM_PUSH')).toBe(false);
  });

  it('applies an emergency disabled-capability override', async () => {
    process.env['ORBIT_DISABLED_CAPABILITIES'] = 'CLINICAL_ORDERS';
    mocks.findPsychologist.mockResolvedValue(
      practitioner([
        { capability: 'CLINICAL_ORDERS', source: 'ADMIN_OVERRIDE', active: true, revokedAt: null },
      ]),
    );
    const effective = await getEffectiveCapabilities('psy-1');
    expect(effective.capabilities.has('CLINICAL_ORDERS')).toBe(false);
  });

  it('derives the practitioner from the session at the execution boundary', async () => {
    mocks.findSession.mockResolvedValue({ psychologistId: 'server-owner' });
    mocks.findPsychologist.mockResolvedValue(
      practitioner([
        {
          capability: 'CLINICAL_ANALYSIS',
          source: 'ADMIN_OVERRIDE',
          active: true,
          revokedAt: null,
        },
      ]),
    );

    await expect(assertSessionCapabilities('session-1', ['CLINICAL_ANALYSIS'])).resolves.toBe(
      'server-owner',
    );
    expect(mocks.findPsychologist).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'server-owner' } }),
    );
  });

  it('fails closed when execution context is omitted', async () => {
    await expect(assertSessionCapabilities('', ['CLINICAL_ANALYSIS'])).rejects.toThrow(
      'Session context is required',
    );
    expect(mocks.findSession).not.toHaveBeenCalled();
  });

  it('audits a boundary-time denial with safe execution metadata before throwing', async () => {
    mocks.findSession.mockResolvedValue({ psychologistId: 'server-owner' });
    mocks.findPsychologist.mockResolvedValue(practitioner());

    await expect(
      assertAuditedSessionCapabilities('session-1', ['CLINICAL_ANALYSIS'], {
        psychologistId: 'server-owner',
        source: 'runClinicalAnalysis',
      }),
    ).rejects.toMatchObject({
      name: 'CapabilityAuthorizationError',
      capability: 'CLINICAL_ANALYSIS',
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: 'server-owner',
        action: 'CAPABILITY_ACCESS_DENIED',
        targetType: 'PractitionerCapability',
        targetId: 'CLINICAL_ANALYSIS',
        metadata: {
          source: 'runClinicalAnalysis',
          sessionId: 'session-1',
          targetType: 'Session',
          targetId: 'session-1',
        },
      },
      undefined,
    );
  });
});
