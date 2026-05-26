import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmdrService } from './emdr.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CreateEmdrTargetInput, PreparationCompleteInput } from '@cureocity/contracts';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const WORKFLOW_ID = 'cwfaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_ID = 'ctgtaaaaaaaaaaaaaaaaaaaaa';

const baseEmdrState = {
  id: WORKFLOW_ID,
  psychologistId: PSY_ID,
  modality: 'EMDR' as const,
  state: {} as unknown,
};

const validTarget: CreateEmdrTargetInput = {
  label: 'Childhood accident',
  image: 'Bus crash, age 8',
  negativeCognition: 'I am not safe',
  positiveCognition: 'I am safe now',
  vocStart: 2,
  sudsStart: 9,
  emotion: 'fear',
  bodyLocation: 'chest tightness',
};

const validPrep: PreparationCompleteInput = {
  safePlaceInstalled: true,
  resourcesAdequate: true,
  dissociationScreened: true,
};

function makeDeps(opts: {
  state?: typeof baseEmdrState | null | { modality?: string; psychologistId?: string };
  targetFindUnique?: ReturnType<typeof vi.fn>;
  targetFindMany?: ReturnType<typeof vi.fn>;
  targetCreate?: ReturnType<typeof vi.fn>;
  targetUpdate?: ReturnType<typeof vi.fn>;
  stateUpdate?: ReturnType<typeof vi.fn>;
}) {
  const state = opts.state === undefined ? baseEmdrState : opts.state;
  const stateFindUnique = vi.fn().mockResolvedValue(state);
  const targetCreate = opts.targetCreate ?? vi.fn();
  const targetUpdate = opts.targetUpdate ?? vi.fn();
  const targetFindUnique = opts.targetFindUnique ?? vi.fn();
  const targetFindMany = opts.targetFindMany ?? vi.fn().mockResolvedValue([]);
  const stateUpdate = opts.stateUpdate ?? vi.fn();
  const txClient = {
    modalityState: { update: stateUpdate },
    emdrTarget: { create: targetCreate, update: targetUpdate },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
  const prisma = {
    modalityState: { findUnique: stateFindUnique },
    emdrTarget: { findUnique: targetFindUnique, findMany: targetFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return {
    prisma,
    audit,
    stateFindUnique,
    targetCreate,
    targetUpdate,
    targetFindUnique,
    targetFindMany,
    stateUpdate,
  };
}

describe('EmdrService.markPreparationComplete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates state and audits EMDR_PREPARATION_COMPLETED', async () => {
    const deps = makeDeps({});
    const svc = new EmdrService(deps.prisma, deps.audit);
    const res = await svc.markPreparationComplete(PSY_ID, WORKFLOW_ID, validPrep, {});
    expect(res.preparationComplete).toBe(true);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMDR_PREPARATION_COMPLETED' }),
      expect.anything(),
    );
  });

  it('rejects when workflow is not EMDR', async () => {
    const deps = makeDeps({ state: { ...baseEmdrState, modality: 'CBT' } });
    const svc = new EmdrService(deps.prisma, deps.audit);
    await expect(
      svc.markPreparationComplete(PSY_ID, WORKFLOW_ID, validPrep, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 404 for cross-tenant workflow', async () => {
    const deps = makeDeps({ state: { ...baseEmdrState, psychologistId: OTHER_PSY_ID } });
    const svc = new EmdrService(deps.prisma, deps.audit);
    await expect(
      svc.markPreparationComplete(PSY_ID, WORKFLOW_ID, validPrep, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EmdrService.addTarget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates target with status=identified and audits EMDR_TARGET_ADDED', async () => {
    const deps = makeDeps({
      targetCreate: vi.fn().mockResolvedValue({
        id: TARGET_ID,
        stateId: WORKFLOW_ID,
        label: validTarget.label,
        image: validTarget.image,
        negativeCognition: validTarget.negativeCognition,
        positiveCognition: validTarget.positiveCognition,
        vocStart: validTarget.vocStart,
        vocCurrent: null,
        sudsStart: validTarget.sudsStart,
        sudsCurrent: null,
        emotion: validTarget.emotion,
        bodyLocation: validTarget.bodyLocation,
        status: 'identified',
        bilateralSetsTotal: 0,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const svc = new EmdrService(deps.prisma, deps.audit);
    const res = await svc.addTarget(PSY_ID, WORKFLOW_ID, validTarget, {});
    expect(res.id).toBe(TARGET_ID);
    expect(res.status).toBe('identified');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMDR_TARGET_ADDED', targetId: TARGET_ID }),
      expect.anything(),
    );
  });
});

describe('EmdrService.updateTarget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists SUDS/VOC updates + appends to notes', async () => {
    const existing = {
      id: TARGET_ID,
      stateId: WORKFLOW_ID,
      sudsCurrent: 7,
      vocCurrent: 3,
      status: 'in_desensitization' as const,
      notes: null,
    };
    const deps = makeDeps({
      targetFindUnique: vi.fn().mockResolvedValue(existing),
      targetUpdate: vi.fn().mockImplementation(async ({ data }) => ({
        ...existing,
        ...data,
        label: 'x',
        image: 'x',
        negativeCognition: 'x',
        positiveCognition: 'x',
        vocStart: 2,
        sudsStart: 9,
        emotion: 'x',
        bodyLocation: 'x',
        bilateralSetsTotal: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
    const svc = new EmdrService(deps.prisma, deps.audit);
    const res = await svc.updateTarget(
      PSY_ID,
      WORKFLOW_ID,
      TARGET_ID,
      { sudsCurrent: 4, vocCurrent: 5, progressNote: 'session 3 reprocessing' },
      {},
    );
    expect(res.sudsCurrent).toBe(4);
    expect(res.vocCurrent).toBe(5);
    expect(res.notes).toMatch(/session 3 reprocessing/);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMDR_TARGET_UPDATED' }),
      expect.anything(),
    );
  });

  it('404 when target belongs to a different workflow', async () => {
    const deps = makeDeps({
      targetFindUnique: vi.fn().mockResolvedValue({ id: TARGET_ID, stateId: 'other_workflow' }),
    });
    const svc = new EmdrService(deps.prisma, deps.audit);
    await expect(
      svc.updateTarget(PSY_ID, WORKFLOW_ID, TARGET_ID, { sudsCurrent: 0 }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EmdrService.listTargets', () => {
  it('returns the targets for the workflow', async () => {
    const deps = makeDeps({
      targetFindMany: vi.fn().mockResolvedValue([
        {
          id: 't1',
          stateId: WORKFLOW_ID,
          label: 'l',
          image: 'i',
          negativeCognition: 'nc',
          positiveCognition: 'pc',
          vocStart: 2,
          vocCurrent: null,
          sudsStart: 9,
          sudsCurrent: null,
          emotion: 'e',
          bodyLocation: 'b',
          status: 'identified',
          bilateralSetsTotal: 0,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    });
    const svc = new EmdrService(deps.prisma, deps.audit);
    const res = await svc.listTargets(PSY_ID, WORKFLOW_ID);
    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe('t1');
  });
});
