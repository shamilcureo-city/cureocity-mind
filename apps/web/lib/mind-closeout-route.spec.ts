import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  sessionFindFirst: vi.fn(),
  closeoutFindUnique: vi.fn(),
  closeoutUpsert: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.requirePsychologistId }));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'request-1' }),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findFirst: mocks.sessionFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { PATCH } from '../app/api/v1/sessions/[id]/mind-closeout/route';
import {
  regulatedPolicyForRequest,
  resolveRegulatedRequirements,
} from './regulated-route-capabilities';

const request = (step = 'followUp', outcome = 'SKIPPED') =>
  new Request('https://example.test/api/v1/sessions/session-1/mind-closeout', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step, outcome }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePsychologistId.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1' },
  });
  mocks.sessionFindFirst.mockResolvedValue({
    id: 'session-1',
    psychologist: { vertical: 'THERAPIST' },
  });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.closeoutFindUnique.mockResolvedValue(null);
  mocks.closeoutUpsert.mockResolvedValue({ sessionId: 'session-1', followUpSkippedAt: new Date() });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      $executeRaw: mocks.executeRaw,
      mindSessionCloseoutState: {
        findUnique: mocks.closeoutFindUnique,
        upsert: mocks.closeoutUpsert,
      },
    }),
  );
});

describe('Mind closeout decision route', () => {
  it('keeps generic session creation vertical-aware for both direct and encounter routes', () => {
    const direct = regulatedPolicyForRequest('api/v1/sessions', 'POST');
    const encounter = regulatedPolicyForRequest('api/v1/encounters', 'POST');

    expect(resolveRegulatedRequirements(direct!, 'THERAPIST')).toEqual([
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
    ]);
    expect(resolveRegulatedRequirements(direct!, 'DOCTOR')).toEqual(['MEDICAL_DOCUMENTATION']);
    expect(resolveRegulatedRequirements(encounter!, 'DOCTOR')).toEqual([
      'LIVE_ENCOUNTER',
      'MEDICAL_DOCUMENTATION',
    ]);
  });

  it('requires behavioral-health documentation and clinical-analysis capabilities', () => {
    const policy = regulatedPolicyForRequest('api/v1/sessions/session-1/mind-closeout', 'PATCH');
    expect(policy?.requirements).toEqual(['BEHAVIORAL_HEALTH_DOCUMENTATION', 'CLINICAL_ANALYSIS']);
  });

  it('looks up only completed sessions before any state-changing transaction', async () => {
    mocks.sessionFindFirst.mockResolvedValue(null);

    const response = await PATCH(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('serializes skip against scheduling and refuses a linked follow-up', async () => {
    mocks.closeoutFindUnique.mockResolvedValue({ followUpSessionId: 'follow-up-1' });

    const response = await PATCH(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.closeoutUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('writes the decision and its audit record in the same transaction', async () => {
    const response = await PATCH(request('clinicalSuggestions', 'COMPLETE') as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.closeoutUpsert).toHaveBeenCalledOnce();
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MIND_CLOSEOUT_DECISION_RECORDED',
        targetId: 'session-1',
        metadata: expect.objectContaining({
          step: 'clinicalSuggestions',
          outcome: 'COMPLETE',
        }),
      }),
      expect.objectContaining({ mindSessionCloseoutState: expect.anything() }),
    );
  });
});
