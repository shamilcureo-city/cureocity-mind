import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MeService } from './me.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { EncryptionService } from '../encryption/encryption.service';

const CLIENT = 'cclient11111111111111111x';

function makeDeps(opts: {
  assignment?: { id: string; clientId: string; status: string; exerciseId: string } | null;
  exerciseList?: unknown[];
  moodList?: unknown[];
  journalList?: unknown[];
  nextSession?: unknown | null;
}) {
  const update = vi.fn().mockImplementation(async ({ data, where }) => ({
    id: where.id,
    clientId: CLIENT,
    psychologistId: 'p',
    exerciseId: 'cbt_thought_record_5col',
    assignedAt: new Date(),
    dueAt: null,
    status: data.status,
    completedAt: data.completedAt ?? null,
    response: data.response ?? null,
    therapistNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const create = vi.fn().mockImplementation(async ({ data }) => ({
    id: 'new_id',
    ...data,
    rating: data.rating ?? null,
    content: data.content ?? null,
    mood: data.mood ?? null,
    notes: data.notes ?? null,
    sharedWithTherapist: data.sharedWithTherapist ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const findUnique = vi.fn().mockResolvedValue(opts.assignment ?? null);
  const findMany = vi
    .fn()
    .mockImplementation(({ where }: { where: { clientId: string; status?: unknown } }) => {
      if ('status' in where) return Promise.resolve(opts.exerciseList ?? []);
      return Promise.resolve(opts.moodList ?? opts.journalList ?? []);
    });
  const txClient = {
    exerciseAssignment: { update },
    moodLog: { create },
    journalEntry: { create },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
  const sessionFindFirst = vi
    .fn()
    .mockResolvedValue(opts.nextSession === undefined ? null : opts.nextSession);
  const pushUpsert = vi
    .fn()
    .mockImplementation(
      async ({
        create,
        update,
        where,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        where: { endpoint: string };
      }) => ({
        id: 'cpush111111111111111111111',
        endpoint: where.endpoint,
        ...create,
        ...update,
        revokedAt: null,
        createdAt: new Date('2026-05-26T00:00:00Z'),
        updatedAt: new Date('2026-05-26T00:00:00Z'),
      }),
    );
  const pushUpdate = vi.fn();
  const pushFindUnique = vi.fn();
  const clientFindUnique = vi
    .fn()
    .mockResolvedValue({ psychologistId: 'cpsy_test_for_journal_owner' });
  const prisma = {
    client: { findUnique: clientFindUnique },
    exerciseAssignment: { findUnique, findMany },
    moodLog: { findMany: vi.fn().mockResolvedValue(opts.moodList ?? []) },
    journalEntry: { findMany: vi.fn().mockResolvedValue(opts.journalList ?? []) },
    session: { findFirst: sessionFindFirst },
    clientPushSubscription: {
      upsert: pushUpsert,
      update: pushUpdate,
      findUnique: pushFindUnique,
    },
    $transaction: transaction,
  } as unknown as PrismaService;
  // The tx client shares the same upsert + update so tests assert
  // through the same vi.fn.
  (txClient as unknown as Record<string, unknown>)['clientPushSubscription'] = {
    upsert: pushUpsert,
    update: pushUpdate,
  };
  const audit = { log: vi.fn() } as unknown as AuditService;
  const encryption = {
    encryptForTenant: vi.fn().mockResolvedValue('v1.k.iv.ct.tag'),
    decrypt: vi.fn(),
    rotate: vi.fn(),
  } as unknown as EncryptionService;
  return {
    prisma,
    audit,
    encryption,
    update,
    create,
    findUnique,
    sessionFindFirst,
    pushUpsert,
    pushUpdate,
    pushFindUnique,
  };
}

describe('MeService.recordCompletion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks PENDING → COMPLETED + writes EXERCISE_COMPLETION_RECORDED', async () => {
    const deps = makeDeps({
      assignment: {
        id: 'a1',
        clientId: CLIENT,
        status: 'PENDING',
        exerciseId: 'cbt_thought_record_5col',
      },
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    const res = await svc.recordCompletion(CLIENT, 'a1', { response: { situation: 'x' } }, {});
    expect(res.status).toBe('COMPLETED');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'CLIENT',
        action: 'EXERCISE_COMPLETION_RECORDED',
      }),
      expect.anything(),
    );
  });

  it('rejects assignment belonging to another client (404)', async () => {
    const deps = makeDeps({
      assignment: {
        id: 'a1',
        clientId: 'other_client',
        status: 'PENDING',
        exerciseId: 'x',
      },
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    await expect(svc.recordCompletion(CLIENT, 'a1', { response: {} }, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects double-completion with 409', async () => {
    const deps = makeDeps({
      assignment: { id: 'a1', clientId: CLIENT, status: 'COMPLETED', exerciseId: 'x' },
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    await expect(svc.recordCompletion(CLIENT, 'a1', { response: {} }, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects SKIPPED / EXPIRED with 400', async () => {
    const deps = makeDeps({
      assignment: { id: 'a1', clientId: CLIENT, status: 'SKIPPED', exerciseId: 'x' },
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    await expect(svc.recordCompletion(CLIENT, 'a1', { response: {} }, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('MeService.logMood', () => {
  it('creates mood log + writes MOOD_LOGGED audit', async () => {
    const deps = makeDeps({});
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    const res = await svc.logMood(CLIENT, { rating: 7, notes: 'better' }, {});
    expect(res.rating).toBe(7);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'CLIENT', action: 'MOOD_LOGGED' }),
      expect.anything(),
    );
  });
});

describe('MeService.createJournal', () => {
  it('persists journal + encrypts content + writes JOURNAL_ENTRY_CREATED audit', async () => {
    const deps = makeDeps({});
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    const res = await svc.createJournal(
      CLIENT,
      { content: 'Today was difficult but I tried a thought record', mood: 4 },
      {},
    );
    expect(res.content).toMatch(/thought record/);
    expect(res.mood).toBe(4);
    expect(res.sharedWithTherapist).toBe(false);
    expect(deps.encryption.encryptForTenant).toHaveBeenCalledWith(
      'cpsy_test_for_journal_owner',
      'Today was difficult but I tried a thought record',
    );
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentEncrypted: 'v1.k.iv.ct.tag' }),
      }),
    );
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'JOURNAL_ENTRY_CREATED',
        metadata: expect.objectContaining({ encrypted: true }),
      }),
      expect.anything(),
    );
  });

  it('falls back to plaintext-only when encryption throws (transition safety)', async () => {
    const deps = makeDeps({});
    (deps.encryption.encryptForTenant as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('KMS unavailable'),
    );
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    const res = await svc.createJournal(CLIENT, { content: 'still works' }, {});
    expect(res.content).toBe('still works');
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentEncrypted: null }),
      }),
    );
  });

  it('honours sharedWithTherapist when set + propagates to audit metadata', async () => {
    const deps = makeDeps({});
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    const res = await svc.createJournal(
      CLIENT,
      { content: 'Open to discuss next time', sharedWithTherapist: true },
      {},
    );
    expect(res.sharedWithTherapist).toBe(true);
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sharedWithTherapist: true }),
      }),
    );
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ sharedWithTherapist: true }),
      }),
      expect.anything(),
    );
  });
});

describe('MeService.getExercise', () => {
  function fullAssignmentRow(overrides: { clientId: string; exerciseId: string }) {
    return {
      id: 'a1',
      clientId: overrides.clientId,
      psychologistId: 'p',
      exerciseId: overrides.exerciseId,
      assignedAt: new Date('2026-05-20T10:00:00Z'),
      dueAt: null,
      status: 'PENDING' as const,
      completedAt: null,
      response: null,
      therapistNote: null,
      createdAt: new Date('2026-05-20T10:00:00Z'),
      updatedAt: new Date('2026-05-20T10:00:00Z'),
    };
  }

  it('returns the assignment when it belongs to the client', async () => {
    const row = fullAssignmentRow({ clientId: CLIENT, exerciseId: 'cbt_thought_record_5col' });
    const deps = makeDeps({});
    (deps.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    const res = await svc.getExercise(CLIENT, 'a1');

    expect(res.id).toBe('a1');
    expect(res.exerciseId).toBe('cbt_thought_record_5col');
  });

  it('rejects 404 for an assignment belonging to another client', async () => {
    const row = fullAssignmentRow({
      clientId: 'other_client',
      exerciseId: 'cbt_thought_record_5col',
    });
    const deps = makeDeps({});
    (deps.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    await expect(svc.getExercise(CLIENT, 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects 404 when the assignment does not exist', async () => {
    const deps = makeDeps({});
    (deps.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    await expect(svc.getExercise(CLIENT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MeService.registerPushSubscription', () => {
  it('upserts the subscription and writes PUSH_SUBSCRIPTION_REGISTERED audit', async () => {
    const deps = makeDeps({});
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    const res = await svc.registerPushSubscription(
      CLIENT,
      {
        endpoint: 'https://fcm.googleapis.com/abc',
        keys: { p256dh: 'p', auth: 'a' },
        userAgent: 'iPhone',
      },
      { requestId: 'r1' },
    );

    expect(res.endpoint).toBe('https://fcm.googleapis.com/abc');
    expect(res.userAgent).toBe('iPhone');
    expect(deps.pushUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: 'https://fcm.googleapis.com/abc' },
        create: expect.objectContaining({
          clientId: CLIENT,
          p256dh: 'p',
          auth: 'a',
        }),
        update: expect.objectContaining({ revokedAt: null }),
      }),
    );
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUSH_SUBSCRIPTION_REGISTERED' }),
      expect.anything(),
    );
  });
});

describe('MeService.revokePushSubscription', () => {
  it('marks the row revoked and audits', async () => {
    const deps = makeDeps({});
    (deps.pushFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'cpush111111111111111111111',
      clientId: CLIENT,
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    await svc.revokePushSubscription(CLIENT, 'cpush111111111111111111111', {});

    expect(deps.pushUpdate).toHaveBeenCalledWith({
      where: { id: 'cpush111111111111111111111' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUSH_SUBSCRIPTION_REVOKED' }),
      expect.anything(),
    );
  });

  it('rejects 404 for cross-client revoke', async () => {
    const deps = makeDeps({});
    (deps.pushFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'cpush111111111111111111111',
      clientId: 'someone-else',
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    await expect(
      svc.revokePushSubscription(CLIENT, 'cpush111111111111111111111', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deps.pushUpdate).not.toHaveBeenCalled();
  });
});

describe('MeService.getNextSession', () => {
  it('returns the next SCHEDULED session with psychologist name', async () => {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const deps = makeDeps({
      nextSession: {
        id: 'csess11111111111111111111',
        scheduledAt,
        modality: 'CBT',
        psychologist: { fullName: 'Dr. Priya Menon' },
      },
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    const res = await svc.getNextSession(CLIENT);

    expect(res).not.toBeNull();
    expect(res?.sessionId).toBe('csess11111111111111111111');
    expect(res?.modality).toBe('CBT');
    expect(res?.psychologistFullName).toBe('Dr. Priya Menon');
    expect(deps.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: CLIENT,
          status: 'SCHEDULED',
        }),
        orderBy: { scheduledAt: 'asc' },
      }),
    );
  });

  it('returns null when no scheduled session exists', async () => {
    const deps = makeDeps({ nextSession: null });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);

    const res = await svc.getNextSession(CLIENT);

    expect(res).toBeNull();
  });
});

describe('MeService.listExercises', () => {
  it('returns only PENDING + IN_PROGRESS assignments', async () => {
    const deps = makeDeps({
      exerciseList: [
        {
          id: 'a1',
          clientId: CLIENT,
          psychologistId: 'p',
          exerciseId: 'cbt_thought_record_5col',
          assignedAt: new Date(),
          dueAt: null,
          status: 'PENDING',
          completedAt: null,
          response: null,
          therapistNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const svc = new MeService(deps.prisma, deps.audit, deps.encryption);
    const res = await svc.listExercises(CLIENT);
    expect(res).toHaveLength(1);
    expect(res[0]!.status).toBe('PENDING');
  });
});
