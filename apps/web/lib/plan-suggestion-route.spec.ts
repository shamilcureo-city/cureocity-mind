import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalReportV1Schema, ClinicalTreatmentPlanSchema } from '@cureocity/contracts';
import { createPlanSuggestionState } from './plan-suggestion-state';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  owned: vi.fn(),
  report: vi.fn(),
  active: vi.fn(),
  claim: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./clinical-mappers', () => ({ toClinicalReport: (row: unknown) => row }));
vi.mock('./phi-write-lock', async () => ({
  ...(await vi.importActual<typeof import('./phi-write-lock')>('./phi-write-lock')),
  lockActiveClientForSession: mocks.lock,
}));
vi.mock('./prisma', () => ({
  prisma: { clinicalReport: { findFirst: mocks.owned }, $transaction: mocks.transaction },
}));

import { POST } from '../app/api/v1/clinical-reports/[id]/plan-suggestion/route';
import { ClientPhiWriteForbiddenError } from './phi-write-lock';

const plan = ClinicalTreatmentPlanSchema.parse({
  modality: 'CBT',
  phaseSequence: ['Assessment', 'Practice'],
  goals: [{ description: 'Review practice', measure: 'At next visit' }],
  expectedDurationSessions: 8,
});
const body = ClinicalReportV1Schema.parse({
  version: 'V1',
  modality: 'CBT',
  diagnosisCandidates: [],
  primaryDiagnosisIndex: null,
  formulation: 'Reviewed evidence',
  treatmentPlan: plan,
  planSuggestions: [
    {
      type: 'ADD_GOAL',
      rationale: 'Reviewed evidence',
      goal: { description: 'New goal', measure: 'At next visit' },
    },
  ],
  recommendedTherapies: [],
});
const state = createPlanSuggestionState({ id: 'plan-1', body: plan }, 'revision-1')!;
const report = {
  id: 'report-1',
  sessionId: 'session-1',
  clientId: 'client-1',
  psychologistId: 'psy-1',
  status: 'COMPLETED',
  body,
  planSuggestionState: state,
};
const send = (
  payload: unknown = { suggestionIndex: 0, revision: state.revision, expectedPlanId: 'plan-1' },
) =>
  POST(
    new Request('https://example.test/api/v1/clinical-reports/report-1/plan-suggestion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }) as never,
    { params: Promise.resolve({ id: 'report-1' }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  mocks.owned.mockResolvedValue({ sessionId: 'session-1' });
  mocks.report.mockResolvedValue(report);
  mocks.active.mockResolvedValue({ id: 'plan-1', version: 1 });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue({ id: 'plan-2', version: 2 });
  mocks.update.mockImplementation(async ({ data }) => ({ ...report, ...data }));
  mocks.lock.mockResolvedValue({ id: 'client-1', psychologistId: 'psy-1' });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: vi.fn(),
      clinicalReport: { findUniqueOrThrow: mocks.report, update: mocks.update },
      treatmentPlan: {
        findFirst: mocks.active,
        updateMany: mocks.claim,
        aggregate: vi.fn(async () => ({ _max: { version: 1 } })),
        create: mocks.create,
      },
    }),
  );
});

describe('plan suggestion transaction boundary', () => {
  it('binds the new plan and durable applied receipt to the same audited transaction', async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), 'session-1', 'psy-1');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 2,
          body: expect.objectContaining({
            goals: expect.arrayContaining([
              expect.objectContaining({ description: 'New goal', measure: 'At next visit' }),
            ]),
          }),
        }),
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'report-1' },
      data: { planSuggestionState: { ...state, currentPlanId: 'plan-2', appliedIndexes: [0] } },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PLAN_CONFIRMED' }),
      expect.objectContaining({ clinicalReport: expect.anything() }),
    );
  });
  it('returns an idempotent receipt for a retry without another plan or audit write', async () => {
    mocks.report.mockResolvedValue({
      ...report,
      planSuggestionState: { ...state, currentPlanId: 'plan-2', appliedIndexes: [0] },
    });
    mocks.active.mockResolvedValue({ id: 'plan-2', version: 2 });
    const response = await send();
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rejects another editor’s plan before superseding or creating anything', async () => {
    mocks.active.mockResolvedValue({ id: 'external-plan', version: 3 });
    expect((await send()).status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  describe.each(['ADJUST_DURATION', 'CHANGE_MODALITY'] as const)('%s conflict', (type) => {
    it.each([false, true])(
      'rejects batch or stored-receipt conflicts before any write (already applied: %s)',
      async (alreadyApplied) => {
        const planSuggestions =
          type === 'ADJUST_DURATION'
            ? [6, 12].map((expectedDurationSessions) => ({
                type,
                rationale: 'Reviewed evidence',
                expectedDurationSessions,
              }))
            : ['EMDR', 'supportive'].map((modality) => ({
                type,
                rationale: 'Reviewed evidence',
                modality,
              }));
        const currentPlanId = alreadyApplied ? 'plan-2' : 'plan-1';
        const persistedState = {
          ...state,
          currentPlanId,
          appliedIndexes: alreadyApplied ? [1] : [],
        };
        mocks.report.mockResolvedValue({
          ...report,
          body: ClinicalReportV1Schema.parse({ ...body, planSuggestions }),
          planSuggestionState: persistedState,
        });
        mocks.active.mockResolvedValue({ id: currentPlanId, version: alreadyApplied ? 2 : 1 });
        const response = await send({
          suggestionIndexes: alreadyApplied ? [0] : [0, 1],
          revision: state.revision,
          expectedPlanId: currentPlanId,
        });
        expect(response.status).toBe(409);
        const payload = await response.json();
        expect(payload.error).toContain('conflict on treatment');
        expect(payload.report).toBeUndefined();
        expect(mocks.claim).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
        expect(persistedState.appliedIndexes).toEqual(alreadyApplied ? [1] : []);
      },
    );
  });
  it('fails closed for legacy reports lacking an immutable baseline', async () => {
    mocks.report.mockResolvedValue({ ...report, planSuggestionState: null });
    expect((await send()).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not expose or write another owner’s report or an erased client', async () => {
    mocks.owned.mockResolvedValue(null);
    expect((await send()).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.owned.mockResolvedValue({ sessionId: 'session-1' });
    mocks.lock.mockRejectedValue(new ClientPhiWriteForbiddenError());
    expect((await send()).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
