import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  queryRaw: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.audit }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: mocks.queryRaw,
        therapyScript: { findFirst: mocks.find, updateMany: mocks.update },
      }),
  },
}));

import { GET, PATCH } from '../app/api/v1/clients/[id]/therapy-scripts/[scriptId]/review/route';
import { regulatedPolicyForRequest } from './regulated-route-capabilities';

const version = '2026-09-06T10:00:00.000Z';
const progress = { version: 1, scriptUpdatedAt: version, activeIndex: 1, reviewedIndexes: [0] };
const script = {
  version: 'V1',
  therapyName: 'Fictional guide',
  openingScript: 'Fictional opening',
  mainExercise: {
    steps: [
      {
        id: 'step',
        purpose: 'Fictional purpose',
        therapistSays: 'Fictional prompt',
        listenFor: 'Fictional context',
        branches: [],
      },
    ],
  },
  closingScript: 'Fictional ending',
  homework: { description: 'Fictional optional discussion', deliveryNotes: 'Only if agreed' },
  adaptationCues: [],
  riskWatchpoints: [],
  estimatedDurationMin: 30,
};
const auth = { ok: true, value: { psychologistId: 'owner', user: { vertical: 'THERAPIST' } } };
const context = { params: Promise.resolve({ id: 'client', scriptId: 'guide' }) };
const request = (method: 'GET' | 'PATCH', body: unknown = progress) =>
  new Request('https://mind.test/api/v1/clients/client/therapy-scripts/guide/review', {
    method,
    ...(method === 'PATCH'
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: 0, ...(body as Record<string, unknown>) }),
        }
      : {}),
  }) as NextRequest;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.queryRaw.mockResolvedValue([{ id: 'client', psychologistId: 'owner' }]);
  mocks.find.mockResolvedValue({
    body: script,
    updatedAt: new Date(version),
    reviewProgress: progress,
  });
  mocks.update.mockResolvedValue({ count: 1 });
});

describe('guide review route boundary and persistence', () => {
  it('reads only owned active-client progress without changing it', async () => {
    const response = await GET(request('GET'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      progress: { ...progress, revision: 0 },
      revision: 0,
      scriptUpdatedAt: version,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'guide', clientId: 'client', psychologistId: 'owner' },
      }),
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('saves navigation metadata without advancing the guide content version', async () => {
    const response = await PATCH(request('PATCH'), context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ updatedAt: new Date(version) }),
        data: { reviewProgress: { ...progress, revision: 1 }, updatedAt: new Date(version) },
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'THERAPY_GUIDE_REVIEW_UPDATED' }),
      expect.anything(),
    );
  });
  it('starts null progress at revision zero and returns the incremented saved revision', async () => {
    mocks.find.mockResolvedValue({
      body: script,
      updatedAt: new Date(version),
      reviewProgress: null,
    });
    expect(await (await GET(request('GET'), context)).json()).toEqual({
      progress: null,
      revision: 0,
      scriptUpdatedAt: version,
    });
    const response = await PATCH(request('PATCH'), context);
    expect(await response.json()).toEqual({ progress: { ...progress, revision: 1 } });
  });
  it('rejects an old view after another view has saved, without overwriting its markers', async () => {
    mocks.find.mockResolvedValue({
      body: script,
      updatedAt: new Date(version),
      reviewProgress: { ...progress, revision: 3, reviewedIndexes: [0, 1, 2] },
    });
    const response = await PATCH(request('PATCH', { ...progress, expectedRevision: 2 }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'GUIDE_REVIEW_CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('accepts only the latest acknowledged revision and increments it atomically under the client lock', async () => {
    mocks.find.mockResolvedValue({
      body: script,
      updatedAt: new Date(version),
      reviewProgress: { ...progress, revision: 3 },
    });
    const response = await PATCH(
      request('PATCH', { ...progress, expectedRevision: 3, activeIndex: 2 }),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      progress: { ...progress, activeIndex: 2, revision: 4 },
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });
  it('cannot supply a stored revision instead of the expected-revision precondition', async () => {
    expect((await PATCH(request('PATCH', { ...progress, revision: 10 }), context)).status).toBe(
      400,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated, wrong vertical and missing capability before data access', async () => {
    mocks.auth.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(request('GET'), context)).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({
      ...auth,
      value: { ...auth.value, user: { vertical: 'DOCTOR' } },
    });
    expect((await GET(request('GET'), context)).status).toBe(404);
    mocks.capability.mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await PATCH(request('PATCH'), context)).status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('fails closed after erasure or when the client belongs to another practitioner', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect((await PATCH(request('PATCH'), context)).status).toBe(404);
    mocks.queryRaw.mockResolvedValueOnce([{ id: 'client', psychologistId: 'someone-else' }]);
    expect((await GET(request('GET'), context)).status).toBe(404);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects cross-client guide ids and concurrent replacement', async () => {
    mocks.find.mockResolvedValueOnce(null);
    expect((await PATCH(request('PATCH'), context)).status).toBe(404);
    mocks.update.mockResolvedValueOnce({ count: 0 });
    expect((await PATCH(request('PATCH'), context)).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([
    { ...progress, scriptUpdatedAt: '2025-01-01T00:00:00.000Z' },
    { ...progress, activeIndex: 4 },
    { ...progress, reviewedIndexes: [4] },
  ])('rejects stale or out-of-range cursor %j', async (body) => {
    expect((await PATCH(request('PATCH', body), context)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('cannot persist suitability or delivery via extra keys', async () => {
    expect((await PATCH(request('PATCH', { ...progress, delivered: true }), context)).status).toBe(
      400,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('declares the same therapy-workflow policy for read and write', () => {
    for (const method of ['GET', 'PATCH'])
      expect(
        regulatedPolicyForRequest('/api/v1/clients/client/therapy-scripts/guide/review', method)
          ?.requirements,
      ).toContain('THERAPY_WORKFLOWS');
  });
});
