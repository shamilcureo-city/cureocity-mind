import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DsrService } from './dsr.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const CLIENT = 'cclient11111111111111111x';
const PSY = 'cpsyaaaaaaaaaaaaaaaaaaaaa';

function makeDeps(opts?: {
  client?: unknown | null;
  activeConsent?: { id: string } | null;
  openErasure?: { id: string; status: string } | null;
  counts?: Partial<{ sessions: number; moods: number; journals: number; assignments: number }>;
  nominationCreate?: ReturnType<typeof vi.fn>;
  erasureCreate?: ReturnType<typeof vi.fn>;
  grievanceCreate?: ReturnType<typeof vi.fn>;
}) {
  const clientFindUnique = vi
    .fn()
    .mockResolvedValue(opts?.client === undefined ? sampleClient() : opts.client);
  const clientUpdate = vi.fn();
  const consentFindFirst = vi
    .fn()
    .mockResolvedValue(
      opts?.activeConsent === undefined ? { id: 'ccon11111111111111111111a' } : opts.activeConsent,
    );
  const consentFindFirstInTransaction = vi
    .fn()
    .mockResolvedValue(
      opts?.activeConsent === undefined ? { id: 'ccon11111111111111111111a' } : opts.activeConsent,
    );
  const consentUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
  const clientRowLock = vi.fn().mockResolvedValue([{ id: CLIENT }]);
  const erasureFindFirst = vi
    .fn()
    .mockResolvedValue(opts?.openErasure === undefined ? null : opts.openErasure);
  const nominationCreate =
    opts?.nominationCreate ??
    vi.fn().mockImplementation(async ({ data }) => ({
      id: 'cnom11111111111111111111a',
      ...data,
      nomineeEmail: data.nomineeEmail ?? null,
      notes: data.notes ?? null,
      supersededAt: null,
      createdAt: new Date('2026-05-26T10:00:00Z'),
      updatedAt: new Date('2026-05-26T10:00:00Z'),
    }));
  const nominationUpdateMany = vi.fn();
  const erasureCreate =
    opts?.erasureCreate ??
    vi.fn().mockImplementation(async ({ data }) => ({
      id: 'cera11111111111111111111a',
      ...data,
      status: 'PENDING' as const,
      reason: data.reason ?? null,
      resolvedByPsychologistId: null,
      resolvedAt: null,
      resolutionNotes: null,
      createdAt: new Date('2026-05-26T10:00:00Z'),
      updatedAt: new Date('2026-05-26T10:00:00Z'),
    }));
  const grievanceCreate =
    opts?.grievanceCreate ??
    vi.fn().mockImplementation(async ({ data }) => ({
      id: 'cgri11111111111111111111a',
      ...data,
      status: 'OPEN' as const,
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNotes: null,
      createdAt: new Date('2026-05-26T10:00:00Z'),
      updatedAt: new Date('2026-05-26T10:00:00Z'),
    }));

  const txClient = {
    client: { update: clientUpdate },
    consent: { findFirst: consentFindFirstInTransaction, updateMany: consentUpdateMany },
    clientNomination: { create: nominationCreate, updateMany: nominationUpdateMany },
    clientErasureRequest: { create: erasureCreate },
    clientGrievance: { create: grievanceCreate },
    auditLog: { create: vi.fn() },
    $queryRaw: clientRowLock,
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));

  const prisma = {
    client: { findUnique: clientFindUnique },
    consent: { findFirst: consentFindFirst },
    clientErasureRequest: { findFirst: erasureFindFirst },
    session: { count: vi.fn().mockResolvedValue(opts?.counts?.sessions ?? 3) },
    moodLog: { count: vi.fn().mockResolvedValue(opts?.counts?.moods ?? 12) },
    journalEntry: { count: vi.fn().mockResolvedValue(opts?.counts?.journals ?? 5) },
    exerciseAssignment: { count: vi.fn().mockResolvedValue(opts?.counts?.assignments ?? 8) },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;

  return {
    prisma,
    audit,
    clientFindUnique,
    clientUpdate,
    consentFindFirst,
    consentFindFirstInTransaction,
    consentUpdateMany,
    clientRowLock,
    erasureFindFirst,
    nominationCreate,
    nominationUpdateMany,
    erasureCreate,
    grievanceCreate,
  };
}

function sampleClient() {
  return {
    id: CLIENT,
    fullNameEncrypted: 'Arjun Mehta',
    contactPhoneEncrypted: '+919900000000',
    contactEmailEncrypted: 'arjun@example.in',
    dateOfBirth: new Date('1990-04-12'),
    presentingConcerns: 'anxiety',
    preferredModality: 'CBT',
    status: 'ACTIVE',
    createdAt: new Date('2026-04-01T00:00:00Z'),
    psychologist: { id: PSY, fullName: 'Dr. Priya Menon', email: 'priya@example.in' },
    consents: [
      {
        scope: 'AUDIO_RECORDING',
        status: 'GRANTED',
        scriptVersion: 'v1.0',
        grantedAt: new Date('2026-04-01T00:00:00Z'),
        withdrawnAt: null,
      },
    ],
    nominations: [],
    erasureRequests: [],
    grievances: [],
  };
}

describe('DsrService.exportData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates client + consents + counts + writes DSR_ACCESS_FULFILLED audit', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);

    const result = await svc.exportData(CLIENT, { requestId: 'r1' });

    expect(result.client.id).toBe(CLIENT);
    expect(result.consents).toHaveLength(1);
    expect(result.sessionCount).toBe(3);
    expect(result.moodLogCount).toBe(12);
    expect(result.exerciseAssignmentCount).toBe(8);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DSR_ACCESS_FULFILLED',
        targetId: CLIENT,
        metadata: expect.objectContaining({ sessionCount: 3, moodLogCount: 12 }),
      }),
    );
  });

  it('rejects 404 when client missing', async () => {
    const deps = makeDeps({ client: null });
    const svc = new DsrService(deps.prisma, deps.audit);
    await expect(svc.exportData(CLIENT, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DsrService.requestCorrection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies the patch + writes DSR_CORRECTION_REQUESTED with before/after', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);
    await svc.requestCorrection(
      CLIENT,
      { contactPhone: '+919800000000', reason: 'phone number changed' },
      {},
    );
    expect(deps.clientUpdate).toHaveBeenCalledWith({
      where: { id: CLIENT },
      data: { contactPhoneEncrypted: '+919800000000' },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DSR_CORRECTION_REQUESTED',
        metadata: expect.objectContaining({
          before: expect.objectContaining({ contactPhoneEncrypted: '+919900000000' }),
          after: expect.objectContaining({ contactPhoneEncrypted: '+919800000000' }),
          reason: 'phone number changed',
        }),
      }),
      expect.anything(),
    );
  });

  it('404s when client missing', async () => {
    const deps = makeDeps();
    (deps.clientFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new DsrService(deps.prisma, deps.audit);
    await expect(
      svc.requestCorrection(CLIENT, { fullName: 'X', reason: 'r' }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DsrService.recordNomination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supersedes prior active nominations and creates a new one', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);
    const result = await svc.recordNomination(
      CLIENT,
      {
        nomineeName: 'Maya Mehta',
        nomineeRelation: 'spouse',
        nomineePhone: '+919800000000',
      },
      {},
    );
    expect(result.nomineeName).toBe('Maya Mehta');
    expect(deps.nominationUpdateMany).toHaveBeenCalledWith({
      where: { clientId: CLIENT, supersededAt: null },
      data: { supersededAt: expect.any(Date) },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DSR_NOMINATION_RECORDED' }),
      expect.anything(),
    );
  });
});

describe('DsrService.withdrawConsent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips status to WITHDRAWN + writes DSR_CONSENT_WITHDRAWN + CONSENT_WITHDRAWN', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);
    await svc.withdrawConsent(CLIENT, { scope: 'CROSS_BORDER_PROCESSING' }, {});
    expect(deps.consentUpdateMany).toHaveBeenCalledWith({
      where: {
        clientId: CLIENT,
        scope: 'CROSS_BORDER_PROCESSING',
        status: 'GRANTED',
        withdrawnAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      data: { status: 'WITHDRAWN', withdrawnAt: expect.any(Date) },
    });
    // Two audit rows fired — DSR-specific + the standard one used by
    // the briefing pipeline.
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DSR_CONSENT_WITHDRAWN' }),
      expect.anything(),
    );
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CONSENT_WITHDRAWN' }),
      expect.anything(),
    );
  });

  it('only selects an unwithdrawn, unexpired GRANTED row', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);

    await svc.withdrawConsent(CLIENT, { scope: 'AUDIO_RECORDING' }, {});

    expect(deps.consentFindFirstInTransaction).toHaveBeenCalledWith({
      where: {
        clientId: CLIENT,
        scope: 'AUDIO_RECORDING',
        status: 'GRANTED',
        withdrawnAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      orderBy: { grantedAt: 'desc' },
    });
  });

  it('locks the client before selecting and withdrawing every duplicate active grant', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);

    await svc.withdrawConsent(CLIENT, { scope: 'AUDIO_RECORDING' }, {});

    expect(deps.consentFindFirst).not.toHaveBeenCalled();
    expect(deps.clientRowLock).toHaveBeenCalledOnce();
    expect(deps.clientRowLock.mock.invocationCallOrder[0]).toBeLessThan(
      deps.consentFindFirstInTransaction.mock.invocationCallOrder[0],
    );
    expect(deps.consentFindFirstInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      deps.consentUpdateMany.mock.invocationCallOrder[0],
    );
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DSR_CONSENT_WITHDRAWN',
        metadata: expect.objectContaining({ withdrawnGrantCount: 2 }),
      }),
      expect.anything(),
    );
  });

  it('400s when no active consent exists for that scope', async () => {
    const deps = makeDeps({ activeConsent: null });
    const svc = new DsrService(deps.prisma, deps.audit);
    await expect(
      svc.withdrawConsent(CLIENT, { scope: 'AUDIO_RECORDING' }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DsrService.fileGrievance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates grievance + writes DSR_GRIEVANCE_FILED', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);
    const result = await svc.fileGrievance(
      CLIENT,
      { subject: 'Concern about my note', body: 'I think the SOAP plan is wrong' },
      {},
    );
    expect(result.subject).toBe('Concern about my note');
    expect(result.status).toBe('OPEN');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DSR_GRIEVANCE_FILED',
        metadata: expect.objectContaining({
          subjectLength: 'Concern about my note'.length,
        }),
      }),
      expect.anything(),
    );
  });
});

describe('DsrService.requestErasure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a PENDING erasure request + writes DSR_ERASURE_REQUESTED', async () => {
    const deps = makeDeps();
    const svc = new DsrService(deps.prisma, deps.audit);
    const result = await svc.requestErasure(CLIENT, { reason: 'Moving to a new therapist' }, {});
    expect(result.status).toBe('PENDING');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DSR_ERASURE_REQUESTED',
        metadata: expect.objectContaining({ hasReason: true }),
      }),
      expect.anything(),
    );
  });

  it('rejects when a PENDING / APPROVED erasure already exists', async () => {
    const deps = makeDeps({ openErasure: { id: 'cera_old', status: 'PENDING' } });
    const svc = new DsrService(deps.prisma, deps.audit);
    await expect(svc.requestErasure(CLIENT, {}, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
