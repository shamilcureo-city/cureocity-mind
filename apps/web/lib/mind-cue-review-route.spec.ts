import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  findMany: vi.fn(),
  previous: vi.fn(),
  lock: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  shown: vi.fn(),
}));
vi.mock('@/lib/auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('@/lib/audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'test' }),
  writeAudit: mocks.audit,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findFirst: mocks.session },
    auditLog: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/phi-write-lock', async (original) => ({
  ...(await original<typeof import('./phi-write-lock')>()),
  lockActiveClientForSession: mocks.lock,
}));
import { ClientPhiWriteForbiddenError } from './phi-write-lock';
import { GET, POST } from '../app/api/v1/sessions/[id]/mind-cue-review/route';
import { POST as recordShown } from '../app/api/v1/sessions/[id]/live-suggestion/route';

const input = {
  id: 'risk-live-fixture',
  kind: 'RED_FLAG',
  state: 'reviewed',
  fingerprint: 'a'.repeat(64),
  operationId: '0d9c2c4e-0434-4810-9f12-cb2e07c54c00',
  expectedRevision: null,
};
const ctx = { params: Promise.resolve({ id: 's1' }) };
const req = (body: unknown = input) =>
  new NextRequest('http://localhost/api/v1/sessions/s1/mind-cue-review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const row = (state = 'reviewed') => ({
  createdAt: new Date('2026-09-09T10:00:00Z'),
  metadata: {
    mindCueReviewVersion: 1,
    suggestionId: input.id,
    kind: input.kind,
    reviewState: state,
    fingerprint: input.fingerprint,
    operationId: input.operationId,
    sessionId: 's1',
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'p1' } });
  mocks.session.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
  mocks.findMany.mockResolvedValue([]);
  mocks.previous.mockResolvedValue(null);
  mocks.lock.mockResolvedValue({ id: 'c1', psychologistId: 'p1' });
  mocks.shown.mockResolvedValue({ id: 'shown1' });
  mocks.transaction.mockImplementation((run) =>
    run({
      session: { findFirst: mocks.session },
      auditLog: {
        findMany: mocks.findMany,
        findFirst: (query: { where: { targetType: string } }) =>
          query.where.targetType === 'LiveSuggestion' ? mocks.shown(query) : mocks.previous(query),
      },
    }),
  );
  mocks.audit.mockResolvedValue(undefined);
});

describe('Mind cue review ownership, durability and correction API', () => {
  it('rejects unauthenticated and non-owned/non-Mind sessions before any audit access', async () => {
    mocks.auth.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await GET(req(), ctx)).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(req(), ctx)).status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 's1',
          psychologistId: 'p1',
          psychologist: { vertical: 'THERAPIST' },
          client: { is: { deletedAt: null } },
        },
      }),
    );
  });

  it('writes no clinical text and acknowledges only after the audit transaction succeeds', async () => {
    const response = await POST(req(), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: input.id,
      state: 'reviewed',
      operationId: input.operationId,
    });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'MindCueReview',
        action: 'LIVE_SUGGESTION_DISMISSED',
        metadata: expect.objectContaining({ clinicalAssessmentRecorded: false }),
      }),
      expect.anything(),
    );
    expect(mocks.audit.mock.calls[0][0].metadata).not.toHaveProperty('label');
    mocks.audit.mockRejectedValue(new Error('Database unavailable'));
    await expect(POST(req(), ctx)).rejects.toThrow('Database unavailable');
  });

  it('returns the existing receipt after an ack-lost retry without another audit write', async () => {
    mocks.previous.mockResolvedValue(row());
    const response = await POST(req(), ctx);
    expect(response.status).toBe(200);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rejects stale corrections and permits an explicit, revision-bound Undo', async () => {
    mocks.previous.mockResolvedValue(row());
    const operationId = 'a626dfe7-62e0-48d6-bf8b-d29a2e75406e';
    expect((await POST(req({ ...input, state: 'reopened', operationId }), ctx)).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(
      (
        await POST(
          req({ ...input, state: 'reopened', operationId, expectedRevision: input.operationId }),
          ctx,
        )
      ).status,
    ).toBe(200);
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({
      action: 'LIVE_SUGGESTION_SHOWN',
      metadata: { reviewState: 'reopened', clinicalAssessmentRecorded: false },
    });
  });

  it('cannot fabricate Undo for an unknown cue or write after the session has ended', async () => {
    expect((await POST(req({ ...input, state: 'reopened' }), ctx)).status).toBe(409);
    mocks.session.mockResolvedValue({ id: 's1', status: 'COMPLETED' });
    expect((await POST(req(), ctx)).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('restores reviewed and reopened history, with no-store and tenant/session-scoped reads', async () => {
    mocks.findMany.mockResolvedValueOnce([row('reopened')]).mockResolvedValueOnce([
      {
        targetId: input.id,
        metadata: { kind: input.kind, label: 'Already audited fixture cue' },
      },
    ]);
    const response = await GET(req(), ctx);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      records: [{ state: 'reopened', fingerprint: input.fingerprint }],
      labels: { [`RED_FLAG:${input.id}`]: 'Already audited fixture cue' },
    });
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      actorPsychologistId: 'p1',
      targetType: 'MindCueReview',
      metadata: { path: ['sessionId'], equals: 's1' },
    });
  });

  it('refuses invalid client fields and incomplete or malformed history rather than hiding safety', async () => {
    expect(
      (await POST(req({ ...input, label: 'do not log me' } as typeof input), ctx)).status,
    ).toBe(400);
    mocks.findMany.mockResolvedValueOnce(Array.from({ length: 501 }, () => row()));
    expect((await GET(req(), ctx)).status).toBe(409);
    mocks.findMany.mockResolvedValueOnce([{ ...row(), metadata: {} }]);
    expect((await GET(req(), ctx)).status).toBe(409);
  });

  it('rejects unknown or cross-kind cue IDs before creating a review mark', async () => {
    mocks.shown.mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.shown.mock.calls[0][0].where).toMatchObject({
      actorPsychologistId: 'p1',
      targetType: 'LiveSuggestion',
      targetId: input.id,
      AND: [
        { metadata: { path: ['sessionId'], equals: 's1' } },
        { metadata: { path: ['kind'], equals: 'RED_FLAG' } },
      ],
    });
    expect(mocks.previous.mock.calls[0][0].where.targetId).toBe(`RED_FLAG:${input.id}`);
  });

  it('does not expose retained audit labels or write a review when erasure wins the shared client lock', async () => {
    mocks.lock.mockRejectedValue(new ClientPhiWriteForbiddenError());
    expect((await GET(req(), ctx)).status).toBe(404);
    expect((await POST(req(), ctx)).status).toBe(404);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.previous).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('the legacy shown writer preserves both verticals but cannot write after client erasure', async () => {
    const shownInput = { event: 'shown', suggestionId: input.id, kind: 'RED_FLAG' };
    for (const vertical of ['THERAPIST', 'DOCTOR']) {
      mocks.session.mockResolvedValueOnce({
        id: 's1',
        psychologistId: 'p1',
        psychologist: { vertical },
      });
      expect((await recordShown(req(shownInput), ctx)).status).toBe(201);
    }
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    mocks.lock.mockRejectedValue(new ClientPhiWriteForbiddenError());
    mocks.session.mockResolvedValueOnce({
      id: 's1',
      psychologistId: 'p1',
      psychologist: { vertical: 'THERAPIST' },
    });
    expect((await recordShown(req(shownInput), ctx)).status).toBe(404);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
  });
});
