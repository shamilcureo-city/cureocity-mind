import { describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AdherenceService } from './adherence.service';
import type { PrismaService } from '../prisma/prisma.service';

const PSY = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const CLIENT = 'cclient11111111111111111x';

const config = {
  get: (k: string) => (k === 'ADHERENCE_WINDOW_DAYS' ? 30 : undefined),
} as ConfigService;

function makeDeps(opts: {
  client?: { id: string; psychologistId: string; deletedAt: Date | null } | null;
  assignments?: Array<{ exerciseId: string; status: string; assignedAt: Date }>;
}) {
  const client =
    opts.client === undefined ? { id: CLIENT, psychologistId: PSY, deletedAt: null } : opts.client;
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue(client) },
    exerciseAssignment: { findMany: vi.fn().mockResolvedValue(opts.assignments ?? []) },
  } as unknown as PrismaService;
  return { prisma };
}

describe('AdherenceService.summaryFor', () => {
  it('returns zeros when no assignments exist', async () => {
    const deps = makeDeps({ assignments: [] });
    const svc = new AdherenceService(deps.prisma, config);
    const sum = await svc.summaryFor(PSY, CLIENT, {});
    expect(sum.totalAssigned).toBe(0);
    expect(sum.completionRate).toBeNull();
    expect(sum.perExercise).toEqual([]);
  });

  it('aggregates by status and per-exercise', async () => {
    const now = new Date();
    const deps = makeDeps({
      assignments: [
        { exerciseId: 'cbt_thought_record_5col', status: 'COMPLETED', assignedAt: now },
        { exerciseId: 'cbt_thought_record_5col', status: 'COMPLETED', assignedAt: now },
        { exerciseId: 'cbt_thought_record_5col', status: 'SKIPPED', assignedAt: now },
        { exerciseId: 'cbt_sleep_hygiene_log', status: 'COMPLETED', assignedAt: now },
        { exerciseId: 'cbt_sleep_hygiene_log', status: 'PENDING', assignedAt: now },
      ],
    });
    const svc = new AdherenceService(deps.prisma, config);
    const sum = await svc.summaryFor(PSY, CLIENT, {});
    expect(sum.totalAssigned).toBe(5);
    expect(sum.totalCompleted).toBe(3);
    expect(sum.totalSkipped).toBe(1);
    expect(sum.totalPending).toBe(1);
    // denominator = 5 - 1 (pending) = 4; completed=3 → 0.75
    expect(sum.completionRate).toBeCloseTo(0.75, 5);
    expect(sum.perExercise).toHaveLength(2);
    const thought = sum.perExercise.find((e) => e.exerciseId === 'cbt_thought_record_5col');
    expect(thought!.assigned).toBe(3);
    expect(thought!.completed).toBe(2);
  });

  it('rejects cross-tenant access (404)', async () => {
    const deps = makeDeps({
      client: { id: CLIENT, psychologistId: 'other', deletedAt: null },
    });
    const svc = new AdherenceService(deps.prisma, config);
    await expect(svc.summaryFor(PSY, CLIENT, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
