import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inTransaction: false,
  lockedClient: [] as Array<{
    id: string;
    psychologistId: string;
    clientFirebaseUid: string | null;
    contactPhoneEncrypted: string | null;
    deletedAt: Date | null;
    status: 'ACTIVE' | 'PAUSED' | 'DISCHARGED';
    vertical: 'THERAPIST' | 'DOCTOR';
  }>,
  queryRaw: vi.fn(),
  tokenUpdateMany: vi.fn(),
  tokenCreate: vi.fn(),
  claimFindUnique: vi.fn(),
  psychologistFindUnique: vi.fn(),
  bindingUpdateMany: vi.fn(),
  claimPhoneMatches: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () => ({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  })),
  resolveFirebaseClaimIdentity: vi.fn(async () => ({
    ok: true,
    value: { firebaseUid: 'firebase-client-1', phoneNumber: '+919876543210' },
  })),
}));
vi.mock('@cureocity/contracts', () => ({
  PatientShareTokenSchema: { safeParse: vi.fn(() => ({ success: true })) },
}));
vi.mock('./client-claim-phone', () => ({ claimPhoneMatches: mocks.claimPhoneMatches }));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./prisma', () => {
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: mocks.queryRaw,
    client: {
      findFirst: vi.fn(async () => ({
        id: 'client-1',
        clientFirebaseUid: null,
        contactPhoneEncrypted: 'encrypted-phone',
        status: 'ACTIVE',
      })),
      updateMany: mocks.bindingUpdateMany,
    },
    psychologist: { findUnique: mocks.psychologistFindUnique },
    clientClaimToken: {
      findUnique: mocks.claimFindUnique,
      updateMany: mocks.tokenUpdateMany,
      create: mocks.tokenCreate,
    },
  };
  return {
    prisma: {
      psychologist: { findUnique: mocks.psychologistFindUnique },
      clientClaimToken: { findUnique: mocks.claimFindUnique },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => {
        mocks.inTransaction = true;
        try {
          return await work(tx);
        } finally {
          mocks.inTransaction = false;
        }
      }),
    },
  };
});

import { POST as issueClaim } from '../app/api/v1/clients/[id]/claim-token/route';
import { POST as redeemClaim } from '../app/api/v1/claim-tokens/[token]/redeem/route';

function issueRequest() {
  return new Request('https://mind.example/api/v1/clients/client-1/claim-token', {
    method: 'POST',
  }) as never;
}

function redeemRequest() {
  return new Request('https://mind.example/api/v1/claim-tokens/claim-token-1/redeem', {
    method: 'POST',
    headers: { authorization: 'Bearer firebase-id-token' },
  }) as never;
}

function activeClaim() {
  return {
    id: 'claim-1',
    token: 'claim-token-1',
    clientId: 'client-1',
    psychologistId: 'psy-1',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    redeemedAt: null,
    redeemedByFirebaseUid: null,
    supersededAt: null,
    client: {
      id: 'client-1',
      psychologistId: 'psy-1',
      clientFirebaseUid: null,
      contactPhoneEncrypted: 'encrypted-phone',
      deletedAt: null,
      status: 'ACTIVE',
      psychologist: { vertical: 'THERAPIST' },
    },
  };
}

function lockedClientSql(): string {
  const call = mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray | undefined;
  return call ? Array.from(call).join('?') : '';
}

async function expectIssuanceLifecycleLossWithoutEffects(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: 'Client not found' });
  expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  expect(mocks.tokenCreate).not.toHaveBeenCalled();
  expect(mocks.writeAudit).not.toHaveBeenCalled();
  expect(lockedClientSql()).toContain('FROM "clients"');
  expect(lockedClientSql()).toContain('FOR UPDATE');
}

describe('R2-07 claim-token issuance lifecycle concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inTransaction = false;
    mocks.lockedClient = [];
    mocks.queryRaw.mockImplementation(async () => mocks.lockedClient);
    mocks.tokenUpdateMany.mockResolvedValue({ count: 0 });
    mocks.tokenCreate.mockResolvedValue({
      id: 'claim-1',
      token: 'claim-token-1',
      clientId: 'client-1',
      psychologistId: 'psy-1',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('leaves no token or audit side effects when erasure wins the Client row-lock race', async () => {
    let finishErasure!: () => void;
    mocks.queryRaw.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishErasure = () => resolve([]);
        }),
    );

    const responsePromise = issueClaim(issueRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    });
    await vi.waitFor(() => expect(mocks.queryRaw).toHaveBeenCalledOnce());
    expect(mocks.tokenCreate).not.toHaveBeenCalled();

    finishErasure();
    await expectIssuanceLifecycleLossWithoutEffects(await responsePromise);
  });

  it('leaves no token or audit side effects when discharge wins the Client row lock', async () => {
    mocks.lockedClient = [
      {
        id: 'client-1',
        psychologistId: 'psy-1',
        clientFirebaseUid: null,
        contactPhoneEncrypted: 'encrypted-phone',
        deletedAt: null,
        status: 'DISCHARGED',
        vertical: 'THERAPIST',
      },
    ];

    const response = await issueClaim(issueRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    });

    await expectIssuanceLifecycleLossWithoutEffects(response);
  });

  it('supersedes only active tokens without recording a redemption', async () => {
    mocks.lockedClient = [
      {
        id: 'client-1',
        psychologistId: 'psy-1',
        clientFirebaseUid: null,
        contactPhoneEncrypted: 'encrypted-phone',
        deletedAt: null,
        status: 'ACTIVE',
        vertical: 'THERAPIST',
      },
    ];

    const response = await issueClaim(issueRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({
      where: { clientId: 'client-1', redeemedAt: null, supersededAt: null },
      data: { supersededAt: expect.any(Date) },
    });
    expect(mocks.tokenUpdateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('redeemedAt');
  });
});

async function expectRedemptionLifecycleLossWithoutEffects(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: 'Claim not found' });
  expect(mocks.bindingUpdateMany).not.toHaveBeenCalled();
  expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  expect(mocks.writeAudit).not.toHaveBeenCalled();
  expect(lockedClientSql()).toContain('FROM "clients"');
  expect(lockedClientSql()).toContain('FOR UPDATE');
}

describe('R2-07 claim-token redemption lifecycle concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inTransaction = false;
    mocks.lockedClient = [];
    mocks.queryRaw.mockImplementation(async () => mocks.lockedClient);
    mocks.psychologistFindUnique.mockResolvedValue(null);
    mocks.claimFindUnique.mockResolvedValue(activeClaim());
    mocks.claimPhoneMatches.mockImplementation(async () => {
      if (mocks.inTransaction) throw new Error('phone decryption must not run in a transaction');
      return true;
    });
    mocks.bindingUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('leaves no binding, token, or audit side effects when erasure wins the Client row-lock race', async () => {
    let finishErasure!: () => void;
    mocks.queryRaw.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishErasure = () => resolve([]);
        }),
    );

    const responsePromise = redeemClaim(redeemRequest(), {
      params: Promise.resolve({ token: 'claim-token-1' }),
    });
    await vi.waitFor(() => expect(mocks.queryRaw).toHaveBeenCalledOnce());
    expect(mocks.bindingUpdateMany).not.toHaveBeenCalled();

    finishErasure();
    await expectRedemptionLifecycleLossWithoutEffects(await responsePromise);
  });

  it('leaves no binding, token, or audit side effects when deactivation wins the Client row lock', async () => {
    mocks.lockedClient = [
      {
        id: 'client-1',
        psychologistId: 'psy-1',
        clientFirebaseUid: null,
        contactPhoneEncrypted: 'encrypted-phone',
        deletedAt: null,
        status: 'PAUSED',
        vertical: 'THERAPIST',
      },
    ];

    const response = await redeemClaim(redeemRequest(), {
      params: Promise.resolve({ token: 'claim-token-1' }),
    });

    await expectRedemptionLifecycleLossWithoutEffects(response);
  });

  it('performs phone verification before opening the persistence transaction', async () => {
    mocks.lockedClient = [
      {
        id: 'client-1',
        psychologistId: 'psy-1',
        clientFirebaseUid: null,
        contactPhoneEncrypted: 'encrypted-phone',
        deletedAt: null,
        status: 'ACTIVE',
        vertical: 'THERAPIST',
      },
    ];

    const response = await redeemClaim(redeemRequest(), {
      params: Promise.resolve({ token: 'claim-token-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.claimPhoneMatches).toHaveBeenCalledOnce();
  });

  it('rejects a superseded token without binding, redeeming, or auditing', async () => {
    mocks.claimFindUnique.mockResolvedValue({
      ...activeClaim(),
      supersededAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    const response = await redeemClaim(redeemRequest(), {
      params: Promise.resolve({ token: 'claim-token-1' }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Claim not found' });
    expect(mocks.bindingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('records true redemption with its Firebase uid without superseding the token', async () => {
    mocks.lockedClient = [
      {
        id: 'client-1',
        psychologistId: 'psy-1',
        clientFirebaseUid: null,
        contactPhoneEncrypted: 'encrypted-phone',
        deletedAt: null,
        status: 'ACTIVE',
        vertical: 'THERAPIST',
      },
    ];

    const response = await redeemClaim(redeemRequest(), {
      params: Promise.resolve({ token: 'claim-token-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'claim-1',
        redeemedAt: null,
        supersededAt: null,
      },
      data: {
        redeemedAt: expect.any(Date),
        redeemedByFirebaseUid: 'firebase-client-1',
      },
    });
    expect(mocks.tokenUpdateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('supersededAt');
  });

  it('fails privately without redeeming or auditing when the conditional binding loses', async () => {
    mocks.lockedClient = [
      {
        id: 'client-1',
        psychologistId: 'psy-1',
        clientFirebaseUid: null,
        contactPhoneEncrypted: 'encrypted-phone',
        deletedAt: null,
        status: 'ACTIVE',
        vertical: 'THERAPIST',
      },
    ];
    mocks.bindingUpdateMany.mockResolvedValue({ count: 0 });

    const response = await redeemClaim(redeemRequest(), {
      params: Promise.resolve({ token: 'claim-token-1' }),
    });

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    expect(mocks.bindingUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'client-1',
        deletedAt: null,
        status: 'ACTIVE',
        OR: [{ clientFirebaseUid: null }, { clientFirebaseUid: 'firebase-client-1' }],
      },
      data: { clientFirebaseUid: 'firebase-client-1' },
    });
  });
});
