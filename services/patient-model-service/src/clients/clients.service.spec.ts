import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CreateClientInput } from '@cureocity/contracts';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const CLIENT_ID = 'cclient11111111111111111x';

const clientRowBase = {
  id: CLIENT_ID,
  psychologistId: PSY_ID,
  fullName: 'Arjun Rao',
  contactPhone: '+919812345678',
  contactEmail: 'arjun@example.in',
  dateOfBirth: new Date('1992-03-14'),
  presentingConcerns: 'Anxiety',
  preferredModality: 'CBT',
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  updatedAt: new Date('2026-05-01T00:00:00Z'),
  deletedAt: null,
};

function makeDeps(overrides?: {
  clientFindUnique?: ReturnType<typeof vi.fn>;
  clientFindMany?: ReturnType<typeof vi.fn>;
  consentFindMany?: ReturnType<typeof vi.fn>;
  sessionFindMany?: ReturnType<typeof vi.fn>;
  clientCreate?: ReturnType<typeof vi.fn>;
  clientUpdate?: ReturnType<typeof vi.fn>;
  consentCreate?: ReturnType<typeof vi.fn>;
}) {
  const clientFindUnique = overrides?.clientFindUnique ?? vi.fn();
  const clientFindMany = overrides?.clientFindMany ?? vi.fn();
  const consentFindMany = overrides?.consentFindMany ?? vi.fn();
  const sessionFindMany = overrides?.sessionFindMany ?? vi.fn();
  const clientCreate = overrides?.clientCreate ?? vi.fn();
  const clientUpdate = overrides?.clientUpdate ?? vi.fn();
  const consentCreate = overrides?.consentCreate ?? vi.fn();

  const txClient = {
    client: { create: clientCreate, update: clientUpdate },
    consent: { create: consentCreate },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));

  const prisma = {
    client: { findUnique: clientFindUnique, findMany: clientFindMany },
    consent: { findMany: consentFindMany },
    session: { findMany: sessionFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;

  const audit = { log: vi.fn() } as unknown as AuditService;

  return {
    prisma,
    audit,
    clientFindUnique,
    clientFindMany,
    consentFindMany,
    sessionFindMany,
    clientCreate,
    clientUpdate,
    consentCreate,
  };
}

const validCreate: CreateClientInput = {
  fullName: 'Arjun Rao',
  contactPhone: '+919812345678',
  contactEmail: 'arjun@example.in',
  presentingConcerns: 'Anxiety',
  preferredModality: 'CBT',
  consents: [
    { scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
    { scope: 'AI_NOTE_GENERATION', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
  ],
};

describe('ClientsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates client + consents in a transaction and writes one audit per row', async () => {
    const deps = makeDeps({
      clientCreate: vi.fn().mockResolvedValue({ ...clientRowBase, id: CLIENT_ID }),
      consentCreate: vi
        .fn()
        .mockResolvedValueOnce({ id: 'consent_1' })
        .mockResolvedValueOnce({ id: 'consent_2' }),
    });
    const svc = new ClientsService(deps.prisma, deps.audit);
    const result = await svc.create(PSY_ID, validCreate, { ip: '1.1.1.1' });

    expect(deps.clientCreate).toHaveBeenCalledOnce();
    expect(deps.consentCreate).toHaveBeenCalledTimes(2);
    // CLIENT_CREATED + 2x CONSENT_GRANTED
    expect(deps.audit.log).toHaveBeenCalledTimes(3);
    const actions = (deps.audit.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    );
    expect(actions).toEqual(['CLIENT_CREATED', 'CONSENT_GRANTED', 'CONSENT_GRANTED']);
    expect(result.id).toBe(CLIENT_ID);
  });
});

describe('ClientsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes by psychologistId and returns nextCursor when paginated', async () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      ...clientRowBase,
      id: `c${String(i).padStart(24, 'a')}`,
    }));
    const deps = makeDeps({ clientFindMany: vi.fn().mockResolvedValue(items) });
    const svc = new ClientsService(deps.prisma, deps.audit);
    const result = await svc.list(PSY_ID, { limit: 10 });
    expect(deps.clientFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ psychologistId: PSY_ID, deletedAt: null }),
        take: 11,
      }),
    );
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBe(items[9]!.id);
  });

  it('returns null cursor when fewer than limit rows exist', async () => {
    const deps = makeDeps({ clientFindMany: vi.fn().mockResolvedValue([clientRowBase]) });
    const svc = new ClientsService(deps.prisma, deps.audit);
    const result = await svc.list(PSY_ID, { limit: 50 });
    expect(result.nextCursor).toBeNull();
  });

  it('filters by status when provided', async () => {
    const deps = makeDeps({ clientFindMany: vi.fn().mockResolvedValue([]) });
    const svc = new ClientsService(deps.prisma, deps.audit);
    await svc.list(PSY_ID, { limit: 50, status: 'DISCHARGED' });
    expect(deps.clientFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'DISCHARGED' }),
      }),
    );
  });
});

describe('ClientsService.get', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the client and writes CLIENT_VIEWED audit', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue(clientRowBase),
    });
    const svc = new ClientsService(deps.prisma, deps.audit);
    const result = await svc.get(PSY_ID, CLIENT_ID, {});
    expect(result.id).toBe(CLIENT_ID);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLIENT_VIEWED', targetId: CLIENT_ID }),
    );
  });

  it('rejects when the client belongs to a different psychologist (as 404 to avoid leaking existence)', async () => {
    const deps = makeDeps({
      clientFindUnique: vi
        .fn()
        .mockResolvedValue({ ...clientRowBase, psychologistId: OTHER_PSY_ID }),
    });
    const svc = new ClientsService(deps.prisma, deps.audit);
    await expect(svc.get(PSY_ID, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(deps.audit.log).not.toHaveBeenCalled();
  });

  it('rejects when the client is soft-deleted', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue({ ...clientRowBase, deletedAt: new Date() }),
    });
    const svc = new ClientsService(deps.prisma, deps.audit);
    await expect(svc.get(PSY_ID, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the client does not exist', async () => {
    const deps = makeDeps({ clientFindUnique: vi.fn().mockResolvedValue(null) });
    const svc = new ClientsService(deps.prisma, deps.audit);
    await expect(svc.get(PSY_ID, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClientsService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists only provided fields and writes audit with before/after diff', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue(clientRowBase),
      clientUpdate: vi.fn().mockResolvedValue({ ...clientRowBase, fullName: 'Arjun K. Rao' }),
    });
    const svc = new ClientsService(deps.prisma, deps.audit);
    await svc.update(PSY_ID, CLIENT_ID, { fullName: 'Arjun K. Rao' }, {});

    expect(deps.clientUpdate).toHaveBeenCalledWith({
      where: { id: CLIENT_ID },
      data: { fullNameEncrypted: 'Arjun K. Rao' },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLIENT_UPDATED',
        metadata: expect.objectContaining({
          before: { fullName: clientRowBase.fullName },
          after: { fullName: 'Arjun K. Rao' },
        }),
      }),
      expect.anything(),
    );
  });
});

describe('ClientsService.briefing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates client + consents + sessions and writes audit', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue(clientRowBase),
      consentFindMany: vi.fn().mockResolvedValue([
        {
          id: 'cnt_1',
          clientId: CLIENT_ID,
          psychologistId: PSY_ID,
          scope: 'AUDIO_RECORDING',
          status: 'GRANTED',
          scriptVersion: 'v1.0',
          capturedVia: 'IN_PERSON',
          grantedAt: new Date('2026-05-01'),
          withdrawnAt: null,
          expiresAt: null,
          notes: null,
          createdAt: new Date('2026-05-01'),
          updatedAt: new Date('2026-05-01'),
        },
      ]),
      sessionFindMany: vi.fn().mockResolvedValue([
        {
          id: 'sess_1',
          modality: 'CBT',
          status: 'SCHEDULED',
          scheduledAt: new Date('2026-06-01'),
          startedAt: null,
          endedAt: null,
        },
      ]),
    });
    const svc = new ClientsService(deps.prisma, deps.audit);
    const result = await svc.briefing(PSY_ID, CLIENT_ID, {});

    expect(result.client.id).toBe(CLIENT_ID);
    expect(result.consents).toHaveLength(1);
    expect(result.recentSessions).toHaveLength(1);
    expect(result.lastNote).toBeNull();
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLIENT_BRIEFING_VIEWED' }),
    );
  });
});
