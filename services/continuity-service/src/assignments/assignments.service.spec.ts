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
  const txClient = { exerciseAssignment: { create } };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
  const prisma = {
    client: { findUnique: clientFindUnique },
    exerciseAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return { prisma, audit, create };
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
