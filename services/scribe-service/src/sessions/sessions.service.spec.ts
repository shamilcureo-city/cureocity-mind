import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { NotesService } from '../notes/notes.service';
import type { SignService } from '../notes/sign.service';
import type { CreateSessionInput, SessionConsentAckInput } from '@cureocity/contracts';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const CLIENT_ID = 'cclient11111111111111111x';
const SESSION_ID = 'csess11111111111111111111';

const baseClient = {
  id: CLIENT_ID,
  psychologistId: PSY_ID,
  deletedAt: null,
};

const baseSession = {
  id: SESSION_ID,
  clientId: CLIENT_ID,
  psychologistId: PSY_ID,
  modality: 'CBT',
  status: 'SCHEDULED' as const,
  scheduledAt: new Date('2026-06-01T10:00:00Z'),
  startedAt: null,
  endedAt: null,
  consentSnapshot: null,
  phaseSnapshot: null,
  createdAt: new Date('2026-05-26T00:00:00Z'),
  updatedAt: new Date('2026-05-26T00:00:00Z'),
};

function makeDeps(overrides?: {
  clientFindUnique?: ReturnType<typeof vi.fn>;
  sessionFindUnique?: ReturnType<typeof vi.fn>;
  sessionCreate?: ReturnType<typeof vi.fn>;
  sessionUpdate?: ReturnType<typeof vi.fn>;
}) {
  const clientFindUnique = overrides?.clientFindUnique ?? vi.fn();
  const sessionFindUnique = overrides?.sessionFindUnique ?? vi.fn();
  const sessionCreate = overrides?.sessionCreate ?? vi.fn();
  const sessionUpdate = overrides?.sessionUpdate ?? vi.fn();

  const txClient = {
    session: { create: sessionCreate, update: sessionUpdate },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));

  const prisma = {
    client: { findUnique: clientFindUnique },
    session: { findUnique: sessionFindUnique },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  const notes = {
    enqueueGeneration: vi.fn().mockResolvedValue(undefined),
    getDraftForSession: vi.fn(),
  } as unknown as NotesService;
  const signer = {
    sign: vi.fn(),
  } as unknown as SignService;

  return {
    prisma,
    audit,
    notes,
    signer,
    clientFindUnique,
    sessionFindUnique,
    sessionCreate,
    sessionUpdate,
  };
}

const validCreate: CreateSessionInput = {
  clientId: CLIENT_ID,
  modality: 'CBT',
  scheduledAt: '2026-06-01T10:00:00Z',
};

describe('SessionsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the session and writes SESSION_CREATED audit', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue(baseClient),
      sessionCreate: vi.fn().mockResolvedValue(baseSession),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    const result = await svc.create(PSY_ID, validCreate, {});
    expect(result.id).toBe(SESSION_ID);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_CREATED', targetId: SESSION_ID }),
      expect.anything(),
    );
  });

  it('rejects with 404 when the client belongs to another psychologist', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue({ ...baseClient, psychologistId: OTHER_PSY_ID }),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await expect(svc.create(PSY_ID, validCreate, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects with 404 when the client is soft-deleted', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue({ ...baseClient, deletedAt: new Date() }),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await expect(svc.create(PSY_ID, validCreate, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SessionsService.recordConsent', () => {
  beforeEach(() => vi.clearAllMocks());

  const validAck: SessionConsentAckInput = {
    scopes: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION'],
    scriptVersion: 'v1.0',
  };

  it('persists the snapshot and writes SESSION_CONSENT_RECORDED audit', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue(baseSession),
      sessionUpdate: vi.fn().mockImplementation(async ({ data }) => ({ ...baseSession, ...data })),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    const result = await svc.recordConsent(PSY_ID, SESSION_ID, validAck, {});
    expect(result.consentSnapshot?.entries).toHaveLength(2);
    expect(result.consentSnapshot?.entries[0]!.scope).toBe('AUDIO_RECORDING');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_CONSENT_RECORDED' }),
      expect.anything(),
    );
  });

  it('rejects when the session is no longer SCHEDULED', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue({ ...baseSession, status: 'IN_PROGRESS' }),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await expect(svc.recordConsent(PSY_ID, SESSION_ID, validAck, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cross-tenant rejected as 404', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi
        .fn()
        .mockResolvedValue({ ...baseSession, psychologistId: OTHER_PSY_ID }),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await expect(svc.recordConsent(PSY_ID, SESSION_ID, validAck, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SessionsService.start', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transitions SCHEDULED → IN_PROGRESS when consent is recorded', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue({
        ...baseSession,
        consentSnapshot: { entries: [], notes: null },
      }),
      sessionUpdate: vi.fn().mockImplementation(async ({ data }) => ({ ...baseSession, ...data })),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    const result = await svc.start(PSY_ID, SESSION_ID, {});
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.startedAt).not.toBeNull();
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_STARTED' }),
      expect.anything(),
    );
  });

  it('rejects when consent has not been recorded', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue({ ...baseSession, consentSnapshot: null }),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await expect(svc.start(PSY_ID, SESSION_ID, {})).rejects.toThrow(/consent must be recorded/i);
  });

  it('rejects when session is not in SCHEDULED state', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue({
        ...baseSession,
        status: 'COMPLETED',
        consentSnapshot: { entries: [], notes: null },
      }),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await expect(svc.start(PSY_ID, SESSION_ID, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SessionsService.end', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transitions IN_PROGRESS → COMPLETED', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue({ ...baseSession, status: 'IN_PROGRESS' }),
      sessionUpdate: vi.fn().mockImplementation(async ({ data }) => ({
        ...baseSession,
        status: 'IN_PROGRESS',
        ...data,
      })),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    const result = await svc.end(PSY_ID, SESSION_ID, {});
    expect(result.status).toBe('COMPLETED');
    expect(result.endedAt).not.toBeNull();
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_ENDED' }),
      expect.anything(),
    );
  });

  it('rejects when session is not IN_PROGRESS', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue(baseSession),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await expect(svc.end(PSY_ID, SESSION_ID, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SessionsService.getNoteDraft', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to NotesService.getDraftForSession', async () => {
    const deps = makeDeps({});
    const mockDraft = { id: 'd1', sessionId: SESSION_ID, status: 'COMPLETED' as const };
    (deps.notes.getDraftForSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockDraft);
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    const result = await svc.getNoteDraft(PSY_ID, SESSION_ID, { ip: '1.1.1.1' });
    expect(result).toBe(mockDraft);
    expect(deps.notes.getDraftForSession).toHaveBeenCalledWith(PSY_ID, SESSION_ID, {
      ip: '1.1.1.1',
    });
  });
});

describe('SessionsService.end', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueues note generation after transitioning to COMPLETED', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue({ ...baseSession, status: 'IN_PROGRESS' }),
      sessionUpdate: vi.fn().mockImplementation(async ({ data }) => ({
        ...baseSession,
        status: 'IN_PROGRESS',
        ...data,
      })),
    });
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    await svc.end(PSY_ID, SESSION_ID, {});
    expect(deps.notes.enqueueGeneration).toHaveBeenCalledWith(SESSION_ID);
  });

  it('still returns the completed session when enqueue fails (non-fatal)', async () => {
    const deps = makeDeps({
      sessionFindUnique: vi.fn().mockResolvedValue({ ...baseSession, status: 'IN_PROGRESS' }),
      sessionUpdate: vi.fn().mockImplementation(async ({ data }) => ({
        ...baseSession,
        status: 'IN_PROGRESS',
        ...data,
      })),
    });
    (deps.notes.enqueueGeneration as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('redis down'),
    );
    const svc = new SessionsService(deps.prisma, deps.audit, deps.notes, deps.signer);
    const result = await svc.end(PSY_ID, SESSION_ID, {});
    expect(result.status).toBe('COMPLETED');
  });
});
