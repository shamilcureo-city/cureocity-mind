import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClaimTokensService } from './claim-tokens.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const CLIENT_ID = 'cclient11111111111111111x';
const TOKEN_ID = 'ctok1111111111111111111111';
const FIREBASE_UID = 'firebase-uid-arjun';
const OTHER_FIREBASE_UID = 'firebase-uid-someone-else';
const VALID_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';

const baseClient = {
  id: CLIENT_ID,
  psychologistId: PSY_ID,
  clientFirebaseUid: null,
  deletedAt: null,
  fullName: 'Arjun Mehta',
};

function inFuture(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function inPast(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function makeDeps(opts?: {
  clientFindUnique?: ReturnType<typeof vi.fn>;
  tokenFindUnique?: ReturnType<typeof vi.fn>;
  tokenCreate?: ReturnType<typeof vi.fn>;
  tokenUpdate?: ReturnType<typeof vi.fn>;
  clientUpdate?: ReturnType<typeof vi.fn>;
}) {
  const clientFindUnique = opts?.clientFindUnique ?? vi.fn();
  const tokenFindUnique = opts?.tokenFindUnique ?? vi.fn();
  const tokenCreate =
    opts?.tokenCreate ??
    vi.fn().mockImplementation(async ({ data }) => ({
      id: TOKEN_ID,
      ...data,
      issuedAt: new Date(),
      redeemedAt: null,
      redeemedByFirebaseUid: null,
    }));
  const tokenUpdate =
    opts?.tokenUpdate ??
    vi.fn().mockImplementation(async ({ where, data }) => ({
      id: where.id ?? TOKEN_ID,
      ...data,
    }));
  const clientUpdate = opts?.clientUpdate ?? vi.fn();

  const txClient = {
    client: { update: clientUpdate },
    clientClaimToken: { create: tokenCreate, update: tokenUpdate },
    auditLog: { create: vi.fn() },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));

  const prisma = {
    client: { findUnique: clientFindUnique },
    clientClaimToken: { findUnique: tokenFindUnique },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;

  return {
    prisma,
    audit,
    clientFindUnique,
    tokenFindUnique,
    tokenCreate,
    tokenUpdate,
    clientUpdate,
  };
}

describe('ClaimTokensService.issue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a 22-char base64url token tied to client + therapist + writes audit', async () => {
    const deps = makeDeps({ clientFindUnique: vi.fn().mockResolvedValue(baseClient) });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    const result = await svc.issue(PSY_ID, CLIENT_ID, { requestId: 'r1' });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(result.clientId).toBe(CLIENT_ID);
    expect(result.psychologistId).toBe(PSY_ID);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86400 * 1000);
    expect(deps.tokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: CLIENT_ID,
        psychologistId: PSY_ID,
        token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      }),
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLIENT_CLAIM_TOKEN_ISSUED',
        targetType: 'ClientClaimToken',
      }),
      expect.anything(),
    );
  });

  it('rejects 404 cross-tenant client (no leak)', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue({ ...baseClient, psychologistId: OTHER_PSY_ID }),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.issue(PSY_ID, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(deps.tokenCreate).not.toHaveBeenCalled();
  });

  it('rejects 404 soft-deleted client', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue({ ...baseClient, deletedAt: new Date() }),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.issue(PSY_ID, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects 409 when client is already paired', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue({ ...baseClient, clientFirebaseUid: 'someone' }),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.issue(PSY_ID, CLIENT_ID, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('honours ttlDays override', async () => {
    const deps = makeDeps({ clientFindUnique: vi.fn().mockResolvedValue(baseClient) });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    const result = await svc.issue(PSY_ID, CLIENT_ID, {}, { ttlDays: 3 });

    const ttlMs = new Date(result.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(2.9 * 86400 * 1000);
    expect(ttlMs).toBeLessThan(3.1 * 86400 * 1000);
  });
});

describe('ClaimTokensService.preview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns first name + therapist full name for a valid unredeemed token', async () => {
    const deps = makeDeps({
      tokenFindUnique: vi.fn().mockResolvedValue({
        id: TOKEN_ID,
        expiresAt: inFuture(7),
        redeemedAt: null,
        client: {
          fullName: 'Arjun Mehta',
          psychologist: { fullName: 'Dr. Priya Menon' },
        },
      }),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    const result = await svc.preview(VALID_TOKEN);

    expect(result.clientFirstName).toBe('Arjun');
    expect(result.psychologistFullName).toBe('Dr. Priya Menon');
    expect(result.redeemed).toBe(false);
  });

  it('flags redeemed tokens (still shown so the user knows their pairing succeeded)', async () => {
    const deps = makeDeps({
      tokenFindUnique: vi.fn().mockResolvedValue({
        id: TOKEN_ID,
        expiresAt: inFuture(7),
        redeemedAt: inPast(0.5),
        client: {
          fullName: 'Arjun Mehta',
          psychologist: { fullName: 'Dr. Priya Menon' },
        },
      }),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    const result = await svc.preview(VALID_TOKEN);

    expect(result.redeemed).toBe(true);
  });

  it('rejects 404 for unknown token', async () => {
    const deps = makeDeps({ tokenFindUnique: vi.fn().mockResolvedValue(null) });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.preview('nonexistenttoken12345A')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects expired tokens', async () => {
    const deps = makeDeps({
      tokenFindUnique: vi.fn().mockResolvedValue({
        id: TOKEN_ID,
        expiresAt: inPast(1),
        redeemedAt: null,
        client: {
          fullName: 'Arjun Mehta',
          psychologist: { fullName: 'Dr. Priya Menon' },
        },
      }),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.preview(VALID_TOKEN)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ClaimTokensService.redeem', () => {
  beforeEach(() => vi.clearAllMocks());

  function tokenRow(
    overrides?: Partial<{
      expiresAt: Date;
      redeemedAt: Date | null;
      redeemedByFirebaseUid: string | null;
      clientFirebaseUid: string | null;
    }>,
  ) {
    return {
      id: TOKEN_ID,
      clientId: CLIENT_ID,
      expiresAt: overrides?.expiresAt ?? inFuture(7),
      redeemedAt: overrides?.redeemedAt ?? null,
      redeemedByFirebaseUid: overrides?.redeemedByFirebaseUid ?? null,
      client: {
        id: CLIENT_ID,
        fullName: 'Arjun Mehta',
        clientFirebaseUid: overrides?.clientFirebaseUid ?? null,
        psychologist: { fullName: 'Dr. Priya Menon' },
      },
    };
  }

  it('happy path: binds Client.clientFirebaseUid, marks token redeemed, writes two audit rows', async () => {
    const deps = makeDeps({
      tokenFindUnique: vi.fn().mockResolvedValue(tokenRow()),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    const result = await svc.redeem(VALID_TOKEN, FIREBASE_UID, { requestId: 'r1' });

    expect(result.clientId).toBe(CLIENT_ID);
    expect(result.clientFirstName).toBe('Arjun');
    expect(deps.clientUpdate).toHaveBeenCalledWith({
      where: { id: CLIENT_ID },
      data: { clientFirebaseUid: FIREBASE_UID },
    });
    expect(deps.tokenUpdate).toHaveBeenCalledWith({
      where: { id: TOKEN_ID },
      data: { redeemedAt: expect.any(Date), redeemedByFirebaseUid: FIREBASE_UID },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLIENT_CLAIM_TOKEN_REDEEMED' }),
      expect.anything(),
    );
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLIENT_FIREBASE_LINKED' }),
      expect.anything(),
    );
  });

  it('is idempotent for the same Firebase uid (returns same result, does not re-update)', async () => {
    const redeemedAt = inPast(0.1);
    const deps = makeDeps({
      tokenFindUnique: vi.fn().mockResolvedValue(
        tokenRow({
          redeemedAt,
          redeemedByFirebaseUid: FIREBASE_UID,
          clientFirebaseUid: FIREBASE_UID,
        }),
      ),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    const result = await svc.redeem(VALID_TOKEN, FIREBASE_UID, {});

    expect(result.redeemedAt).toBe(redeemedAt.toISOString());
    expect(deps.clientUpdate).not.toHaveBeenCalled();
    expect(deps.tokenUpdate).not.toHaveBeenCalled();
  });

  it('rejects 409 when token already redeemed by a different uid', async () => {
    const deps = makeDeps({
      tokenFindUnique: vi.fn().mockResolvedValue(
        tokenRow({
          redeemedAt: inPast(0.1),
          redeemedByFirebaseUid: OTHER_FIREBASE_UID,
        }),
      ),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.redeem(VALID_TOKEN, FIREBASE_UID, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects 409 when client is bound to a different uid (race / re-pair attempt)', async () => {
    const deps = makeDeps({
      tokenFindUnique: vi
        .fn()
        .mockResolvedValue(tokenRow({ clientFirebaseUid: OTHER_FIREBASE_UID })),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.redeem(VALID_TOKEN, FIREBASE_UID, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects expired token', async () => {
    const deps = makeDeps({
      tokenFindUnique: vi.fn().mockResolvedValue(tokenRow({ expiresAt: inPast(1) })),
    });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.redeem(VALID_TOKEN, FIREBASE_UID, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unknown token', async () => {
    const deps = makeDeps({ tokenFindUnique: vi.fn().mockResolvedValue(null) });
    const svc = new ClaimTokensService(deps.prisma, deps.audit);

    await expect(svc.redeem('nope12345nope12345nope', FIREBASE_UID, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
