import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CreateExerciseAssignmentInput } from '@cureocity/contracts';

const PSY = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const CLIENT = 'cclient11111111111111111x';

function makeDeps(opts: {
  client?: { id: string; psychologistId: string; deletedAt: Date | null } | null;
  createReturn?: unknown;
  sourceSession?: { id: string } | null;
  existing?: unknown;
  lockedClient?: {
    id: string;
    psychologistId: string;
    deletedAt: Date | null;
    status: 'ACTIVE' | 'PAUSED';
  } | null;
  lockedSourceSession?: { id: string } | null;
}) {
  const client =
    opts.client === undefined ? { id: CLIENT, psychologistId: PSY, deletedAt: null } : opts.client;
  const clientFindUnique = vi.fn().mockResolvedValue(client);
  const create = vi.fn().mockResolvedValue(
    opts.createReturn ?? {
      id: 'a1',
      clientId: CLIENT,
      psychologistId: PSY,
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
  );
  const findUnique = vi.fn().mockResolvedValue(opts.existing ?? null);
  const lockedClient =
    opts.lockedClient === undefined
      ? [{ id: CLIENT, psychologistId: PSY, deletedAt: null, status: 'ACTIVE' as const }]
      : opts.lockedClient
        ? [opts.lockedClient]
        : [];
  const lockedSourceSession = opts.lockedSourceSession ? [opts.lockedSourceSession] : [];
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce(lockedClient)
    .mockResolvedValueOnce(lockedSourceSession);
  const txClient = {
    $executeRaw: vi.fn(),
    $queryRaw: queryRaw,
    exerciseAssignment: { create, findUnique },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
  const prisma = {
    client: { findUnique: clientFindUnique },
    session: { findFirst: vi.fn().mockResolvedValue(opts.sourceSession ?? null) },
    exerciseAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return { prisma, audit, create, findUnique, queryRaw };
}

const validInput: CreateExerciseAssignmentInput = {
  clientId: CLIENT,
  exerciseId: 'cbt_thought_record_5col',
};

describe('AssignmentsService.assign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates assignment and audits EXERCISE_ASSIGNED', async () => {
    const deps = makeDeps({});
    const svc = new AssignmentsService(deps.prisma, deps.audit);
    const res = await svc.assign(PSY, validInput, {});
    expect(res.exerciseId).toBe('cbt_thought_record_5col');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXERCISE_ASSIGNED' }),
      expect.anything(),
    );
  });

  it('persists explicit custom homework fields', async () => {
    const deps = makeDeps({});
    const svc = new AssignmentsService(deps.prisma, deps.audit);
    await svc.assign(
      PSY,
      {
        clientId: CLIENT,
        task: 'Practise paced breathing',
        frequency: 'Daily',
        deliveryChannel: 'PORTAL_LINK',
      },
      {},
    );
    expect(deps.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exerciseId: null,
        source: 'CUSTOM',
        customDescription: 'Practise paced breathing',
        frequency: 'Daily',
        deliveryChannel: 'PORTAL_LINK',
      }),
    });
  });

  it('rejects unknown exercise id', async () => {
    const deps = makeDeps({});
    const svc = new AssignmentsService(deps.prisma, deps.audit);
    await expect(
      svc.assign(PSY, { ...validInput, exerciseId: 'cbt_made_up_thing' }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects cross-tenant client (404)', async () => {
    const deps = makeDeps({
      client: { id: CLIENT, psychologistId: OTHER_PSY, deletedAt: null },
    });
    const svc = new AssignmentsService(deps.prisma, deps.audit);
    await expect(svc.assign(PSY, validInput, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a source session not linked to the tenant client', async () => {
    const deps = makeDeps({ sourceSession: null });
    const svc = new AssignmentsService(deps.prisma, deps.audit);
    await expect(
      svc.assign(PSY, { ...validInput, sourceSessionId: 'csession1111111111111111x' }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not persist or audit after erasure wins the client row lock', async () => {
    const deps = makeDeps({ lockedClient: null });
    const svc = new AssignmentsService(deps.prisma, deps.audit);

    await expect(svc.assign(PSY, validInput, {})).rejects.toBeInstanceOf(NotFoundException);

    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.audit.log).not.toHaveBeenCalled();
    const lockedSql = Array.from(deps.queryRaw.mock.calls[0]?.[0] ?? []).join('?');
    expect(lockedSql).toContain('FROM "clients"');
    expect(lockedSql).toContain('FOR UPDATE');
  });

  it('does not persist or audit after client deactivation wins the row lock', async () => {
    const deps = makeDeps({
      lockedClient: {
        id: CLIENT,
        psychologistId: PSY,
        deletedAt: null,
        status: 'PAUSED',
      },
    });
    const svc = new AssignmentsService(deps.prisma, deps.audit);

    await expect(svc.assign(PSY, validInput, {})).rejects.toBeInstanceOf(NotFoundException);

    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.audit.log).not.toHaveBeenCalled();
  });

  it('revalidates tenant-owned source provenance under lock before insert', async () => {
    const sourceSessionId = 'csession1111111111111111x';
    const deps = makeDeps({
      sourceSession: { id: sourceSessionId },
      lockedSourceSession: null,
    });
    const svc = new AssignmentsService(deps.prisma, deps.audit);

    await expect(svc.assign(PSY, { ...validInput, sourceSessionId }, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.audit.log).not.toHaveBeenCalled();
    const lockedSql = Array.from(deps.queryRaw.mock.calls[1]?.[0] ?? []).join('?');
    expect(lockedSql).toContain('FROM "sessions"');
    expect(lockedSql).toContain('FOR UPDATE');
  });

  it('replays the exact idempotent payload without creating or auditing twice', async () => {
    const existing = {
      id: 'a-existing',
      clientId: CLIENT,
      psychologistId: PSY,
      exerciseId: null,
      source: 'CUSTOM',
      customDescription: 'Practise paced breathing',
      sourceTherapyScriptId: null,
      sourceSessionId: null,
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      assignedAt: new Date(),
      dueAt: null,
      frequency: 'Daily',
      deliveryChannel: 'PORTAL_LINK',
      status: 'PENDING',
      completedAt: null,
      response: null,
      respondedAt: null,
      responseShareId: null,
      responseShareBatchId: null,
      therapistNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const deps = makeDeps({ existing });
    const svc = new AssignmentsService(deps.prisma, deps.audit);
    const result = await svc.assign(
      PSY,
      {
        clientId: CLIENT,
        task: 'Practise paced breathing',
        frequency: 'Daily',
        deliveryChannel: 'PORTAL_LINK',
        idempotencyKey: existing.idempotencyKey,
      },
      {},
    );
    expect(result.id).toBe(existing.id);
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.audit.log).not.toHaveBeenCalled();
  });

  it('accepts EMDR exercise ids', async () => {
    const deps = makeDeps({
      createReturn: {
        id: 'a2',
        clientId: CLIENT,
        psychologistId: PSY,
        exerciseId: 'emdr_safe_place_installation',
        assignedAt: new Date(),
        dueAt: null,
        status: 'PENDING',
        completedAt: null,
        response: null,
        therapistNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const svc = new AssignmentsService(deps.prisma, deps.audit);
    const res = await svc.assign(
      PSY,
      { ...validInput, exerciseId: 'emdr_safe_place_installation' },
      {},
    );
    expect(res.exerciseId).toBe('emdr_safe_place_installation');
  });
});
