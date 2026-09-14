import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMDR_PHASES } from '@cureocity/clinical';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  transition: vi.fn(),
  audit: vi.fn(),
  queryRaw: vi.fn(),
  existing: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('./audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('./mappers', () => ({ toModalityStateWithHistory: (row: unknown) => row }));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.client },
    modalityState: { findUnique: mocks.find },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: mocks.queryRaw,
        modalityState: {
          create: mocks.create,
          update: mocks.update,
          findUnique: mocks.existing,
          findUniqueOrThrow: mocks.find,
        },
        modalityTransition: { create: mocks.transition },
      }),
  },
}));
import { POST } from '../app/api/v1/workflows/route';
import { POST as transition } from '../app/api/v1/workflows/[id]/transitions/route';
import { GET } from '../app/api/v1/clients/[id]/workflow/route';
import { regulatedPolicyForRequest } from './regulated-route-capabilities';

const clientId = 'c' + '1'.repeat(24);
const workflowId = 'c' + '2'.repeat(24);
const workflow = () => ({
  id: workflowId,
  clientId,
  psychologistId: 'owner',
  modality: 'EMDR',
  currentPhase: 'history_taking',
  state: {},
  goals: [{ id: 'goal-1', description: 'Fictional goal', achieved: false }],
  transitions: [],
  completedAt: null,
});
const create = (initialPhase: string, extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('https://mind.test/api/v1/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId,
        modality: 'EMDR',
        initialPhase,
        goals: [{ id: 'goal-1', description: 'Fictional goal' }],
        ...extra,
      }),
    }),
  );
const advance = (toPhase: string) =>
  transition(
    new NextRequest(`https://mind.test/api/v1/workflows/${workflowId}/transitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toPhase, reason: 'Fictional clinician-reviewed transition' }),
    }),
    { params: Promise.resolve({ id: workflowId }) },
  );

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'owner' } });
  mocks.client.mockResolvedValue({ id: clientId, psychologistId: 'owner', modalityState: null });
  mocks.find.mockResolvedValue(workflow());
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...workflow(),
    ...data,
  }));
  mocks.transition.mockResolvedValue({ id: 'transition-1' });
  mocks.queryRaw.mockResolvedValue([{ id: clientId, psychologistId: 'owner' }]);
  mocks.existing.mockResolvedValue(null);
});

describe('EMDR workflow creation invariant', () => {
  it.each(EMDR_PHASES.filter((phase) => phase !== 'history_taking'))(
    'rejects direct creation at %s without writes',
    async (phase) => {
      const response = await create(phase);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'EMDR_INITIAL_PHASE_REQUIRED' });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it('does not accept supplied prerequisite flags as prior-care evidence', async () => {
    expect(
      (
        await create('desensitization', {
          state: { preparationComplete: true, hasTargets: true },
          preparationComplete: true,
          hasTargets: true,
        })
      ).status,
    ).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a canonical start without inventing completed prerequisites', async () => {
    expect((await create('history_taking')).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentPhase: 'history_taking', state: {} }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORKFLOW_CREATED' }),
      expect.anything(),
    );
  });

  it('preserves the existing CBT starting-phase behavior', async () => {
    expect((await create('cognitive_restructuring', { modality: 'CBT' })).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ modality: 'CBT', currentPhase: 'cognitive_restructuring' }),
      }),
    );
  });

  it('rejects unknown phases and non-workflow modalities', async () => {
    expect((await create('invented')).status).toBe(400);
    expect((await create('history_taking', { modality: 'ACT' })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('preserves authentication, ownership and existing-workflow checks', async () => {
    mocks.auth.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Denied' }, { status: 403 }),
    });
    expect((await create('history_taking')).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    mocks.client.mockResolvedValueOnce({
      id: clientId,
      psychologistId: 'another-owner',
      modalityState: null,
    });
    expect((await create('history_taking')).status).toBe(404);
    mocks.client.mockResolvedValueOnce({
      id: clientId,
      psychologistId: 'owner',
      modalityState: { id: workflowId },
    });
    expect((await create('history_taking')).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('retains regulated workflow permission policies', () => {
    for (const path of ['/api/v1/workflows', `/api/v1/workflows/${workflowId}/transitions`]) {
      const policy = regulatedPolicyForRequest(path, 'POST');
      expect(policy?.requirements).toContain('THERAPY_WORKFLOWS');
    }
  });

  it('rejects an erased client before opening a write transaction', async () => {
    mocks.client.mockResolvedValue({
      id: clientId,
      psychologistId: 'owner',
      deletedAt: new Date(),
      modalityState: null,
    });
    expect((await create('history_taking')).status).toBe(404);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('locks the active client and checks for a concurrent workflow before writing', async () => {
    expect((await create('history_taking')).status).toBe(201);
    const sql = Array.from(mocks.queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sql).toContain('c."deletedAt" IS NULL');
    expect(sql).toContain('FOR UPDATE OF c');
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.existing.mock.invocationCallOrder[0]!,
    );
    expect(mocks.existing.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]!,
    );
  });

  it('fails closed if erasure wins before the locked recheck', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.queryRaw.mockImplementationOnce(async () => {
      await held;
      return [];
    });
    const pending = create('history_taking');
    await vi.waitFor(() => expect(mocks.queryRaw).toHaveBeenCalledOnce());
    expect(mocks.create).not.toHaveBeenCalled();
    release();
    expect((await pending).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rechecks ownership and duplicate starts under the client lock', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: clientId, psychologistId: 'another-owner' }]);
    expect((await create('history_taking')).status).toBe(404);
    mocks.existing.mockResolvedValueOnce({ id: workflowId });
    expect((await create('history_taking')).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('existing EMDR workflows', () => {
  it('still permits history to preparation without inventing prerequisites', async () => {
    expect((await advance('preparation')).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: workflowId },
      data: { currentPhase: 'preparation' },
    });
  });

  it.each([
    {},
    { preparationComplete: true, hasTargets: false },
    { preparationComplete: 'false', hasTargets: 'true' },
  ])('rejects transition when prerequisite records are incomplete: %j', async (state) => {
    mocks.find.mockResolvedValue({ ...workflow(), currentPhase: 'assessment', state });
    expect((await advance('desensitization')).status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('allows recorded prerequisites and keeps clinician attribution', async () => {
    mocks.find.mockResolvedValue({
      ...workflow(),
      currentPhase: 'assessment',
      state: { preparationComplete: true, hasTargets: true },
    });
    expect((await advance('desensitization')).status).toBe(200);
    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trigger: 'PSYCHOLOGIST_MANUAL', psychologistId: 'owner' }),
      }),
    );
  });

  it('preserves closure as an available transition even with missing historical prerequisites', async () => {
    mocks.find.mockResolvedValue({ ...workflow(), currentPhase: 'desensitization' });
    expect((await advance('closure')).status).toBe(200);
  });

  it('does not transition a completed or another owner workflow', async () => {
    mocks.find.mockResolvedValueOnce({ ...workflow(), completedAt: new Date() });
    expect((await advance('preparation')).status).toBe(409);
    mocks.find.mockResolvedValueOnce({ ...workflow(), psychologistId: 'another-owner' });
    expect((await advance('preparation')).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('reads incomplete historical records unchanged, without a backfill', async () => {
    const historical = { ...workflow(), currentPhase: 'desensitization' };
    mocks.find.mockResolvedValue(historical);
    const response = await GET(
      new NextRequest(`https://mind.test/api/v1/clients/${clientId}/workflow`),
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(historical);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
