import { describe, expect, it, vi } from 'vitest';
import {
  MedicalSigningAuthorizationError,
  lockAndResolveMedicalSigningAuthority,
} from './medical-signing-authority';

const NOW = new Date('2026-08-18T12:00:00.000Z');

const practitioner = {
  id: 'psy-1',
  vertical: 'DOCTOR',
  profession: 'PHYSICIAN',
  status: 'ACTIVE',
  deletedAt: null,
};

const credential = (overrides: Record<string, unknown> = {}) => ({
  id: 'cred-state',
  psychologistId: 'psy-1',
  kind: 'STATE_MEDICAL_COUNCIL_REGISTRATION',
  registrationNumber: '  MH-123  ',
  issuingAuthority: '  Maharashtra Medical Council  ',
  jurisdiction: 'IN',
  status: 'VERIFIED',
  verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  ...overrides,
});

const draftingGrant = {
  capability: 'PRESCRIPTION_DRAFTING',
  source: 'ADMIN_OVERRIDE',
  active: true,
  revokedAt: null,
};

function transaction(args?: {
  practitioner?: object | null;
  credentials?: object[];
  practitionerGrants?: object[];
  memberships?: object[];
  clinicGrants?: object[];
}) {
  const rows = [
    args?.practitioner === undefined
      ? [practitioner]
      : args.practitioner
        ? [args.practitioner]
        : [],
    args?.credentials ?? [credential()],
    args?.practitionerGrants ?? [draftingGrant],
    args?.memberships ?? [],
    args?.clinicGrants ?? [],
  ];
  return {
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve(rows.shift() ?? [])),
  };
}

describe('transaction-bound medical signing authority', () => {
  it('locks authority rows and snapshots the deterministically selected exact credential', async () => {
    const tx = transaction({
      credentials: [
        credential({ id: 'cred-state', registrationNumber: 'ZZ-9' }),
        credential({
          id: 'cred-nmc-b',
          kind: 'NMC_REGISTRATION',
          registrationNumber: '  NMC-002 ',
          issuingAuthority: ' National Medical Commission ',
        }),
        credential({
          id: 'cred-nmc-a',
          kind: 'NMC_REGISTRATION',
          registrationNumber: 'NMC-001',
          issuingAuthority: 'National Medical Commission',
        }),
      ],
    });

    const result = await lockAndResolveMedicalSigningAuthority(tx as never, 'psy-1', NOW);

    expect(result).toEqual({
      id: 'cred-nmc-a',
      kind: 'NMC_REGISTRATION',
      registrationNumber: 'NMC-001',
      issuingAuthority: 'National Medical Commission',
      jurisdiction: 'IN',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
    for (const [sql] of tx.$queryRaw.mock.calls) {
      expect(Array.from(sql as TemplateStringsArray).join('?')).toContain('FOR UPDATE');
    }
  });

  it('accepts organization authority only after locking membership and clinic grant rows', async () => {
    const tx = transaction({
      practitionerGrants: [],
      memberships: [{ clinicId: 'clinic-1' }],
      clinicGrants: [{ ...draftingGrant, source: 'ORGANIZATION_POLICY' }],
    });

    await expect(
      lockAndResolveMedicalSigningAuthority(tx as never, 'psy-1', NOW),
    ).resolves.toMatchObject({ id: 'cred-state' });
  });

  it.each([
    ['pending', { status: 'PENDING_VERIFICATION' }],
    ['missing verifiedAt', { verifiedAt: null }],
    ['invalid verifiedAt', { verifiedAt: 'not-a-date' }],
    ['future verifiedAt', { verifiedAt: new Date('2026-08-19T00:00:00.000Z') }],
    ['expired', { expiresAt: NOW }],
    ['invalid expiry', { expiresAt: 'not-a-date' }],
    ['foreign jurisdiction', { jurisdiction: 'US' }],
    ['blank registration evidence', { registrationNumber: '   ' }],
    ['blank authority evidence', { issuingAuthority: '\t' }],
    ['non-medical kind', { kind: 'RCI_REGISTRATION' }],
  ])('rejects %s credential evidence', async (_label, overrides) => {
    const tx = transaction({ credentials: [credential(overrides)] });

    await expect(lockAndResolveMedicalSigningAuthority(tx as never, 'psy-1', NOW)).rejects.toEqual(
      expect.objectContaining({
        name: 'MedicalSigningAuthorizationError',
        reason: 'NO_QUALIFYING_CREDENTIAL',
      }),
    );
  });

  it('rejects revoked effective signing authority despite a qualifying credential', async () => {
    const tx = transaction({
      practitionerGrants: [
        { ...draftingGrant, active: false, revokedAt: new Date('2026-08-18T11:59:00.000Z') },
      ],
    });

    await expect(lockAndResolveMedicalSigningAuthority(tx as never, 'psy-1', NOW)).rejects.toEqual(
      expect.objectContaining({
        name: 'MedicalSigningAuthorizationError',
        reason: 'MISSING_PRESCRIPTION_SIGNING',
      }),
    );
  });

  it('fails closed for a suspended practitioner', async () => {
    const tx = transaction({ practitioner: { ...practitioner, status: 'SUSPENDED' } });

    await expect(
      lockAndResolveMedicalSigningAuthority(tx as never, 'psy-1', NOW),
    ).rejects.toBeInstanceOf(MedicalSigningAuthorizationError);
  });
});
