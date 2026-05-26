import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WorkflowsService } from './workflows.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CreateWorkflowInput } from '@cureocity/contracts';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const CLIENT_ID = 'cclient11111111111111111x';
const WORKFLOW_ID = 'cwfaaaaaaaaaaaaaaaaaaaaaa';

const baseClient = { id: CLIENT_ID, psychologistId: PSY_ID, deletedAt: null };
const baseState = {
  id: WORKFLOW_ID,
  clientId: CLIENT_ID,
  psychologistId: PSY_ID,
  modality: 'CBT' as const,
  currentPhase: 'engagement_assessment',
  state: {} as Prisma.JsonValue,
  goals: [] as Prisma.JsonValue,
  startedAt: new Date('2026-05-01T00:00:00Z'),
  completedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  updatedAt: new Date('2026-05-01T00:00:00Z'),
};

const validCreate: CreateWorkflowInput = {
  clientId: CLIENT_ID,
  modality: 'CBT',
  initialPhase: 'engagement_assessment',
  goals: [{ id: 'g1', description: 'Reduce work-related anxiety' }],
};

function makeDeps(overrides?: {
  clientFindUnique?: ReturnType<typeof vi.fn>;
  stateFindUnique?: ReturnType<typeof vi.fn>;
  stateCreate?: ReturnType<typeof vi.fn>;
  stateUpdate?: ReturnType<typeof vi.fn>;
  transitionCreate?: ReturnType<typeof vi.fn>;
  transitionFindMany?: ReturnType<typeof vi.fn>;
}) {
  const clientFindUnique = overrides?.clientFindUnique ?? vi.fn();
  const stateFindUnique = overrides?.stateFindUnique ?? vi.fn();
  const stateCreate = overrides?.stateCreate ?? vi.fn();
  const stateUpdate = overrides?.stateUpdate ?? vi.fn();
  const transitionCreate = overrides?.transitionCreate ?? vi.fn();
  const transitionFindMany = overrides?.transitionFindMany ?? vi.fn().mockResolvedValue([]);
  const txClient = {
    modalityState: { create: stateCreate, update: stateUpdate },
    modalityTransition: { create: transitionCreate, findMany: transitionFindMany },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
  const prisma = {
    client: { findUnique: clientFindUnique },
    modalityState: { findUnique: stateFindUnique },
    modalityTransition: { findMany: transitionFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return {
    prisma,
    audit,
    clientFindUnique,
    stateFindUnique,
    stateCreate,
    stateUpdate,
    transitionCreate,
    transitionFindMany,
  };
}

describe('WorkflowsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a workflow and writes WORKFLOW_CREATED audit', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue(baseClient),
      stateCreate: vi.fn().mockResolvedValue(baseState),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    const result = await svc.create(PSY_ID, validCreate, {});
    expect(result.id).toBe(WORKFLOW_ID);
    expect(result.currentPhase).toBe('engagement_assessment');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKFLOW_CREATED', targetId: WORKFLOW_ID }),
      expect.anything(),
    );
  });

  it('returns 404 for a cross-tenant client', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue({ ...baseClient, psychologistId: OTHER_PSY_ID }),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    await expect(svc.create(PSY_ID, validCreate, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('translates duplicate (unique on clientId) to 409', async () => {
    const deps = makeDeps({
      clientFindUnique: vi.fn().mockResolvedValue(baseClient),
      stateCreate: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['clientId'] },
        }),
      ),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    await expect(svc.create(PSY_ID, validCreate, {})).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('WorkflowsService.recordTransition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a manual transition and audits WORKFLOW_PHASE_TRANSITIONED', async () => {
    const deps = makeDeps({
      stateFindUnique: vi.fn().mockResolvedValue(baseState),
      transitionCreate: vi.fn().mockResolvedValue({
        id: 't1',
        stateId: WORKFLOW_ID,
        fromPhase: 'engagement_assessment',
        toPhase: 'psychoeducation',
        trigger: 'PSYCHOLOGIST_MANUAL',
        reason: 'goals achieved',
        psychologistId: PSY_ID,
        evidence: null,
        occurredAt: new Date(),
      }),
      stateUpdate: vi.fn().mockResolvedValue({ ...baseState, currentPhase: 'psychoeducation' }),
      transitionFindMany: vi.fn().mockResolvedValue([]),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    const result = await svc.recordTransition(
      PSY_ID,
      WORKFLOW_ID,
      { toPhase: 'psychoeducation', reason: 'goals achieved' },
      {},
    );
    expect(result.currentPhase).toBe('psychoeducation');
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WORKFLOW_PHASE_TRANSITIONED',
        targetId: WORKFLOW_ID,
      }),
      expect.anything(),
    );
  });

  it('rejects an invalid CBT transition (unknown phase)', async () => {
    const deps = makeDeps({ stateFindUnique: vi.fn().mockResolvedValue(baseState) });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    await expect(
      svc.recordTransition(PSY_ID, WORKFLOW_ID, { toPhase: 'not_a_phase', reason: 'oops' }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects transition to the same phase', async () => {
    const deps = makeDeps({ stateFindUnique: vi.fn().mockResolvedValue(baseState) });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    await expect(
      svc.recordTransition(
        PSY_ID,
        WORKFLOW_ID,
        { toPhase: 'engagement_assessment', reason: 'noop' },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects transition on a completed workflow', async () => {
    const deps = makeDeps({
      stateFindUnique: vi.fn().mockResolvedValue({ ...baseState, completedAt: new Date() }),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    await expect(
      svc.recordTransition(
        PSY_ID,
        WORKFLOW_ID,
        { toPhase: 'cognitive_restructuring', reason: 'late' },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 404 for a cross-tenant workflow', async () => {
    const deps = makeDeps({
      stateFindUnique: vi.fn().mockResolvedValue({ ...baseState, psychologistId: OTHER_PSY_ID }),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    await expect(
      svc.recordTransition(PSY_ID, WORKFLOW_ID, { toPhase: 'psychoeducation', reason: 'x' }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkflowsService.getAdvancementSuggestion', () => {
  it('returns a real suggestion via @cureocity/clinical evaluator', async () => {
    const sessionFindMany = vi.fn().mockResolvedValue([]);
    const transitionFindFirst = vi.fn().mockResolvedValue(null);
    const stateFindUnique = vi.fn().mockResolvedValue(baseState);
    const prisma = {
      modalityState: { findUnique: stateFindUnique },
      modalityTransition: {
        findFirst: transitionFindFirst,
        findMany: vi.fn().mockResolvedValue([]),
      },
      session: { findMany: sessionFindMany },
    } as unknown as Parameters<typeof WorkflowsService.prototype.create>[0] extends never
      ? never
      : never;
    const audit = { log: vi.fn() };
    const svc = new WorkflowsService(prisma as never, audit as never);
    const sug = await svc.getAdvancementSuggestion(PSY_ID, WORKFLOW_ID, {});
    expect(sug.currentPhase).toBe('engagement_assessment');
    // 0 sessions, min-floor=1 not met → stay
    expect(sug.suggestedPhase).toBeNull();
    expect(sug.rationale).toMatch(/minimum-sessions/i);
  });

  it('returns a non-CBT advisory message for other modalities', async () => {
    const deps = makeDeps({
      stateFindUnique: vi.fn().mockResolvedValue({ ...baseState, modality: 'OTHER' }),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    const sug = await svc.getAdvancementSuggestion(PSY_ID, WORKFLOW_ID, {});
    expect(sug.suggestedPhase).toBeNull();
    expect(sug.rationale).toMatch(/ships in a later sprint/i);
  });
});

describe('WorkflowsService.prescribe', () => {
  it('returns recommendations and audits one EXERCISE_PRESCRIBED per item', async () => {
    const deps = makeDeps({ stateFindUnique: vi.fn().mockResolvedValue(baseState) });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    const res = await svc.prescribe(
      PSY_ID,
      WORKFLOW_ID,
      { recentRiskSeverity: 'none', maxRecommendations: 3 },
      {},
    );
    expect(res.currentPhase).toBe('engagement_assessment');
    expect(res.recommendations.length).toBeGreaterThan(0);
    expect(res.recommendations.length).toBeLessThanOrEqual(3);
    expect(deps.audit.log).toHaveBeenCalled();
    const auditActions = (deps.audit.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    );
    expect(auditActions.every((a) => a === 'EXERCISE_PRESCRIBED')).toBe(true);
  });

  it('rejects for non-CBT modalities', async () => {
    const deps = makeDeps({
      stateFindUnique: vi.fn().mockResolvedValue({ ...baseState, modality: 'OTHER' }),
    });
    const svc = new WorkflowsService(deps.prisma, deps.audit);
    await expect(
      svc.prescribe(PSY_ID, WORKFLOW_ID, { recentRiskSeverity: 'none', maxRecommendations: 5 }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
