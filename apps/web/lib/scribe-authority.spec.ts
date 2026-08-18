import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  findConsents: vi.fn(),
  assertCapabilities: vi.fn(),
  writeAudit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.findSession },
    consent: { findMany: mocks.findConsents },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./capabilities', () => ({
  assertAuditedSessionCapabilities: mocks.assertCapabilities,
}));
vi.mock('./audit', () => ({ writeAudit: mocks.writeAudit }));

import { assertCurrentScribeAuthority, ScribeAuthorityError } from './scribe-authority';

const session = {
  psychologistId: 'psy-1',
  clientId: 'client-1',
  client: { status: 'ACTIVE', deletedAt: null },
  psychologist: { vertical: 'DOCTOR' },
};
const allConsents = [
  { scope: 'AUDIO_RECORDING' },
  { scope: 'AI_NOTE_GENERATION' },
  { scope: 'CROSS_BORDER_PROCESSING' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      session: { findUnique: mocks.findSession },
      consent: { findMany: mocks.findConsents },
    }),
  );
  mocks.findSession.mockResolvedValue(session);
  mocks.findConsents.mockResolvedValue(allConsents);
  mocks.assertCapabilities.mockResolvedValue('psy-1');
});

describe('current scribe authority', () => {
  it('requires active client, all current consents, active practitioner, ambient capture and vertical documentation', async () => {
    await expect(
      assertCurrentScribeAuthority('session-1', {
        psychologistId: 'psy-1',
        source: 'pass1BeforeModel',
      }),
    ).resolves.toMatchObject({ psychologistId: 'psy-1', clientId: 'client-1', vertical: 'DOCTOR' });

    expect(mocks.findConsents).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'GRANTED',
          withdrawnAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    );
    expect(mocks.assertCapabilities).toHaveBeenCalledWith(
      'session-1',
      ['AMBIENT_CAPTURE', 'MEDICAL_DOCUMENTATION'],
      { psychologistId: 'psy-1', source: 'pass1BeforeModel' },
    );
  });

  it.each(['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'])(
    'denies when standing %s consent is absent without placing PHI in the audit',
    async (missing) => {
      mocks.findConsents.mockResolvedValue(allConsents.filter(({ scope }) => scope !== missing));

      await expect(
        assertCurrentScribeAuthority('session-1', {
          psychologistId: 'psy-1',
          source: 'pass1BeforeModel',
        }),
      ).rejects.toBeInstanceOf(ScribeAuthorityError);

      expect(mocks.assertCapabilities).not.toHaveBeenCalled();
      expect(mocks.writeAudit).toHaveBeenCalledWith({
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: 'psy-1',
        action: 'CAPABILITY_ACCESS_DENIED',
        targetType: 'ScribeAuthority',
        targetId: 'DENIED',
        metadata: { source: 'pass1BeforeModel', sessionId: 'session-1', reason: 'CONSENT' },
      });
      expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('client-1');
    },
  );

  it.each([
    ['inactive', { status: 'INACTIVE', deletedAt: null }],
    ['deleted', { status: 'ACTIVE', deletedAt: new Date() }],
  ])('denies an %s client before capability resolution', async (_label, client) => {
    mocks.findSession.mockResolvedValue({ ...session, client });

    await expect(
      assertCurrentScribeAuthority('session-1', {
        psychologistId: 'psy-1',
        source: 'pass2BeforePersistence',
      }),
    ).rejects.toBeInstanceOf(ScribeAuthorityError);
    expect(mocks.assertCapabilities).not.toHaveBeenCalled();
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          source: 'pass2BeforePersistence',
          sessionId: 'session-1',
          reason: 'CLIENT',
        },
      }),
    );
  });

  it('uses behavioral-health documentation for therapist sessions', async () => {
    mocks.findSession.mockResolvedValue({
      ...session,
      psychologist: { vertical: 'THERAPIST' },
    });

    await assertCurrentScribeAuthority('session-1', {
      psychologistId: 'psy-1',
      source: 'pass2BeforeModel',
    });

    expect(mocks.assertCapabilities).toHaveBeenCalledWith(
      'session-1',
      ['AMBIENT_CAPTURE', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
      expect.anything(),
    );
  });
});
