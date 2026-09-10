import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { RecoverySession, RecoveryStandingConsent } from './mind-consent-recovery-server';
import { SessionConsentSnapshotSchema, ScriptVersionSchema } from '@cureocity/contracts';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  lock: vi.fn(),
  query: vi.fn(),
  session: vi.fn(),
  update: vi.fn(),
  standing: vi.fn(),
  grant: vi.fn(),
  receipt: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/audit', () => ({
  writeAudit: mocks.audit,
  auditMetadataFromRequest: () => ({ requestId: 'test-only' }),
}));
vi.mock('@/lib/phi-write-lock', async (original) => ({
  ...(await original<typeof import('./phi-write-lock')>()),
  lockActiveClientForSession: mocks.lock,
}));

import { GET, POST } from '../app/api/v1/sessions/[id]/consent-recovery/route';
import { ClientPhiWriteForbiddenError } from './phi-write-lock';
import {
  MIND_CONSENT_RECOVERY_SCOPES,
  MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  MindConsentRecoveryInputSchema,
  MindConsentRecoveryStateSchema,
  MindConsentRecoveryReceiptSchema,
} from './mind-consent-recovery';
import { MAX_RECOVERY_SNAPSHOT_ENTRIES } from './mind-consent-recovery-server';

const now = new Date('2026-09-09T15:00:00.000Z');
const operationId = 'c6b604e9-0f15-49aa-85c0-5b350947db10';
const ctx = { params: Promise.resolve({ id: 's1' }) };
const confirmations = {
  AUDIO_RECORDING: true,
  AI_NOTE_GENERATION: true,
  CROSS_BORDER_PROCESSING: true,
};
let current: RecoverySession;
let grants: RecoveryStandingConsent[];
let audits: { metadata: Record<string, unknown>; action: string }[];
const request = (body?: unknown) =>
  new NextRequest('http://localhost/api/v1/sessions/s1/consent-recovery', {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
const postInput = async (overrides = {}) => ({
  operationId,
  expectedRevision: (await (await GET(request(), ctx)).json()).revision,
  confirmations,
  ...overrides,
});
const tx = {
  $queryRaw: mocks.query,
  session: { findFirst: mocks.session, update: mocks.update },
  consent: { findMany: mocks.standing, create: mocks.grant },
  auditLog: { findFirst: mocks.receipt },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  current = {
    id: 's1',
    clientId: 'c1',
    psychologistId: 'p1',
    status: 'IN_PROGRESS',
    startedAt: new Date('2026-09-09T14:00:00Z'),
    endedAt: null,
    therapyNote: null,
    consentSnapshot: {
      entries: [
        {
          scope: 'AUDIO_RECORDING',
          scriptVersion: 'v1.0',
          ackedAt: '2026-09-08T10:00:00Z',
        },
        {
          scope: 'DATA_RETENTION_EXTENDED',
          scriptVersion: 'v1.0',
          ackedAt: '2026-09-08T10:00:00Z',
        },
      ],
      notes: 'Fictional private consent discussion',
    },
  };
  grants = MIND_CONSENT_RECOVERY_SCOPES.map((scope, index) => ({
    id: `g${index}`,
    scope,
    status: 'GRANTED',
    scriptVersion: 'v1.0',
    capturedVia: 'IN_PERSON',
    grantedAt: new Date('2026-09-01T10:00:00Z'),
    withdrawnAt: null,
    expiresAt: null,
    updatedAt: new Date('2026-09-01T10:00:00Z'),
  }));
  audits = [];
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'p1' } });
  mocks.capability.mockImplementation(async (_req, _capability, auth) => auth);
  mocks.lock.mockResolvedValue({ id: 'c1', psychologistId: 'p1' });
  mocks.query.mockResolvedValue([{ id: 's1' }]);
  mocks.session.mockImplementation(async () => structuredClone(current));
  mocks.standing.mockImplementation(async () => structuredClone(grants));
  mocks.update.mockImplementation(async ({ data }) => {
    current.consentSnapshot = structuredClone(data.consentSnapshot);
    return current;
  });
  mocks.grant.mockImplementation(async ({ data }) => {
    const grant = {
      ...data,
      id: `new-${grants.length}`,
      withdrawnAt: null,
      expiresAt: null,
      updatedAt: new Date(),
    };
    grants.push(grant);
    return grant;
  });
  mocks.audit.mockImplementation(async (data) => {
    audits.push(structuredClone(data));
  });
  mocks.receipt.mockImplementation(async ({ where }) => {
    const operation = where.AND[1].metadata.equals;
    return audits.find(
      (audit) =>
        audit.action === 'SESSION_CONSENT_RECORDED' && audit.metadata.operationId === operation,
    );
  });
  // A transaction-shaped fake provides rollback and serialization, not a
  // substitute for PostgreSQL lock integration testing.
  let pending = Promise.resolve();
  mocks.transaction.mockImplementation((run) => {
    const result = pending.then(async () => {
      const before = structuredClone({ current, grants, audits });
      try {
        return await run(tx);
      } catch (error) {
        ({ current, grants, audits } = before);
        throw error;
      }
    });
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  });
});
afterEach(() => vi.useRealTimers());

describe('Mind same-session consent recovery', () => {
  it('uses the real stored snapshot/script contracts for the recovery revision', () => {
    expect(ScriptVersionSchema.safeParse(MIND_CONSENT_RECOVERY_SCRIPT_VERSION).success).toBe(true);
    expect(SessionConsentSnapshotSchema.safeParse(current.consentSnapshot).success).toBe(true);
  });
  it('reads only the owned active Mind session under Client then Session locks without mutations', async () => {
    const response = await GET(request(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      sessionId: 's1',
      status: 'IN_PROGRESS',
      ready: false,
    });
    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 's1',
          clientId: 'c1',
          psychologistId: 'p1',
          psychologist: { vertical: 'THERAPIST' },
          client: { is: { deletedAt: null } },
        },
      }),
    );
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.query.mock.invocationCallOrder[0],
    );
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.session.mock.invocationCallOrder[0],
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('fails authentication and capability denials before data access', async () => {
    mocks.auth.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({}, { status: 401 }),
    });
    expect((await GET(request(), ctx)).status).toBe(401);
    mocks.capability.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({}, { status: 403 }),
    });
    expect((await POST(request({}), ctx)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('requires both live and behavioral health capabilities', async () => {
    await GET(request(), ctx);
    expect(mocks.capability.mock.calls.map((call) => call[1])).toEqual([
      'LIVE_ENCOUNTER',
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
    ]);
  });

  it.each(['foreign owner', 'erased client', 'client erasure after preflight'])(
    'rejects %s without writes',
    async () => {
      const input = await postInput();
      mocks.lock.mockRejectedValue(new ClientPhiWriteForbiddenError());
      expect((await POST(request(input), ctx)).status).toBe(404);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it('rejects wrong vertical or changed session/client linkage after the lock', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(request(), ctx)).status).toBe(404);
    expect(mocks.standing).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const)(
    'rejects %s including lifecycle races',
    async (status) => {
      const input = await postInput();
      current.status = status;
      expect((await GET(request(), ctx)).status).toBe(409);
      expect((await POST(request(input), ctx)).status).toBe(409);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('rejects any previously signed note even if the session still says IN_PROGRESS', async () => {
    const input = await postInput();
    current.therapyNote = { id: 'signed-or-unlocked-note' };
    expect((await POST(request(input), ctx)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('requires all three explicit true confirmations and a strict revision-bound payload', async () => {
    const input = await postInput();
    for (const body of [
      { ...input, confirmations: {} },
      { ...input, confirmations: { ...confirmations, AUDIO_RECORDING: false } },
      { ...input, confirmations: { ...confirmations, DATA_RETENTION_EXTENDED: true } },
      { ...input, scriptVersion: 'client-picked-script' },
      { ...input, operationId: 'not-a-uuid' },
      { ...input, expectedRevision: 'stale' },
    ]) {
      expect(MindConsentRecoveryInputSchema.safeParse(body).success).toBe(false);
      expect((await POST(request(body), ctx)).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('appends prospective acknowledgements while keeping exact session, prior notes/history and retention untouched', async () => {
    const before = structuredClone(current);
    const response = await POST(request(await postInput()), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const receipt = MindConsentRecoveryReceiptSchema.parse(await response.json());
    expect(receipt).toMatchObject({
      sessionId: 's1',
      status: 'IN_PROGRESS',
      ready: true,
      replayed: false,
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { consentSnapshot: expect.any(Object) },
    });
    expect({ ...current, consentSnapshot: null }).toEqual({ ...before, consentSnapshot: null });
    const snapshot = current.consentSnapshot as { entries: unknown[]; notes: string };
    expect(snapshot.entries.slice(0, 2)).toEqual(
      (before.consentSnapshot as { entries: unknown[] }).entries,
    );
    expect(snapshot.notes).toBe('Fictional private consent discussion');
    expect(snapshot.entries.slice(2)).toEqual(
      MIND_CONSENT_RECOVERY_SCOPES.map((scope) => ({
        scope,
        scriptVersion: MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
        ackedAt: now.toISOString(),
      })),
    );
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(JSON.stringify(audits)).not.toContain('Fictional private consent discussion');
    expect(audits[0]?.metadata).toMatchObject({
      authorizesPreviousProcessing: false,
      authorizationAppliesFrom: now.toISOString(),
      previousSnapshot: (before.consentSnapshot as { entries: unknown[] }).entries,
    });
  });

  it('handles a missing snapshot on a scheduled session without starting it', async () => {
    current.status = 'SCHEDULED';
    current.startedAt = null;
    current.consentSnapshot = null;
    expect((await POST(request(await postInput()), ctx)).status).toBe(200);
    expect(current.status).toBe('SCHEDULED');
    expect(current.startedAt).toBeNull();
  });

  it('does not infer current consent from a complete historical session snapshot', async () => {
    current.consentSnapshot = {
      entries: MIND_CONSENT_RECOVERY_SCOPES.map((scope) => ({
        scope,
        scriptVersion: 'v1.0',
        ackedAt: '2026-09-08T10:00:00Z',
      })),
      notes: null,
    };
    grants[2]!.withdrawnAt = now;
    const state = await (await GET(request(), ctx)).json();
    expect(state.ready).toBe(false);
    expect(state.scopes[2]).toMatchObject({
      sessionAcknowledged: true,
      standingStatus: 'WITHDRAWN',
    });
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('validates complete, unique scope evidence before accepting any ready state or receipt', async () => {
    const receipt = await (await POST(request(await postInput()), ctx)).json();
    expect(MindConsentRecoveryStateSchema.safeParse(receipt).success).toBe(true);
    for (const scopes of [
      [],
      receipt.scopes.slice(0, 2),
      [receipt.scopes[0], receipt.scopes[0], receipt.scopes[2]],
      receipt.scopes.map((scope: object, index: number) =>
        index === 2 ? { ...scope, standingStatus: 'WITHDRAWN' } : scope,
      ),
    ]) {
      expect(MindConsentRecoveryStateSchema.safeParse({ ...receipt, scopes }).success).toBe(false);
      expect(MindConsentRecoveryReceiptSchema.safeParse({ ...receipt, scopes }).success).toBe(
        false,
      );
    }
    expect(MindConsentRecoveryReceiptSchema.safeParse({ ...receipt, ready: false }).success).toBe(
      false,
    );
  });

  it.each(['withdrawn', 'expired', 'missing'])(
    'creates a fresh explicitly confirmed %s grant and keeps old rows intact',
    async (reason) => {
      if (reason === 'missing') grants.pop();
      else if (reason === 'withdrawn') {
        grants[2]!.status = 'WITHDRAWN';
        grants[2]!.withdrawnAt = new Date('2026-09-08T10:00:00Z');
      } else grants[2]!.expiresAt = new Date('2026-09-08T10:00:00Z');
      const oldGrants = structuredClone(grants);
      const response = await POST(request(await postInput()), ctx);
      expect(response.status).toBe(200);
      expect(grants.slice(0, oldGrants.length)).toEqual(oldGrants);
      expect(mocks.grant).toHaveBeenCalledOnce();
      expect(mocks.grant.mock.calls[0][0].data).toMatchObject({
        scope: 'CROSS_BORDER_PROCESSING',
        status: 'GRANTED',
        grantedAt: now,
      });
    },
  );

  it.each(['withdrawal', 'expiry', 'snapshot', 'start'])(
    'rejects stale confirmation after %s changes between read and save',
    async (change) => {
      grants[2]!.expiresAt = new Date(now.getTime() + 1000);
      const input = await postInput();
      if (change === 'withdrawal') grants[2]!.withdrawnAt = now;
      else if (change === 'expiry') vi.setSystemTime(new Date(now.getTime() + 1001));
      else if (change === 'snapshot') current.consentSnapshot = null;
      else current.startedAt = new Date(now.getTime() - 1000);
      const response = await POST(request(input), ctx);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'MIND_CONSENT_RECOVERY_CONFLICT' });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.grant).not.toHaveBeenCalled();
    },
  );

  it('replays a lost acknowledgement without another grant, snapshot or audit write', async () => {
    grants.pop();
    const input = await postInput();
    const first = await (await POST(request(input), ctx)).json();
    const second = await (await POST(request(input), ctx)).json();
    expect(second).toEqual({ ...first, replayed: true });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.grant).toHaveBeenCalledOnce();
    expect(audits).toHaveLength(2);
  });

  it.each(['withdrawal', 'expiry', 'later correction', 'changed payload'])(
    'does not replay ready or regrant after %s',
    async (change) => {
      grants[2]!.expiresAt = new Date(now.getTime() + 1000);
      const input = await postInput();
      expect((await POST(request(input), ctx)).status).toBe(200);
      if (change === 'withdrawal') grants[2]!.withdrawnAt = now;
      else if (change === 'expiry') vi.setSystemTime(new Date(now.getTime() + 1001));
      else if (change === 'later correction') current.consentSnapshot = null;
      else input.expectedRevision = 'b'.repeat(64);
      expect((await POST(request(input), ctx)).status).toBe(409);
      expect(mocks.update).toHaveBeenCalledOnce();
      expect(mocks.grant).not.toHaveBeenCalled();
    },
  );

  it('serializes concurrent same-operation retries to one committed receipt', async () => {
    const input = await postInput();
    const responses = await Promise.all([POST(request(input), ctx), POST(request(input), ctx)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(audits).toHaveLength(1);
  });

  it('rejects a different concurrent operation reviewed against the old revision', async () => {
    const input = await postInput();
    await POST(request(input), ctx);
    expect(
      (await POST(request({ ...input, operationId: '4e05a609-8445-44d7-a8c7-887bed4f720a' }), ctx))
        .status,
    ).toBe(409);
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it('rolls back snapshot/grants when audit persistence fails rather than acknowledge unsaved consent', async () => {
    grants.pop();
    const input = await postInput();
    const before = structuredClone({ current, grants });
    mocks.audit.mockRejectedValue(new Error('Audit unavailable'));
    await expect(POST(request(input), ctx)).rejects.toThrow('Audit unavailable');
    expect({ current, grants }).toEqual(before);
  });

  it('rolls back a newly saved snapshot when a prior grant expires during the transaction', async () => {
    grants[2]!.expiresAt = new Date(now.getTime() + 1000);
    const input = await postInput();
    const before = structuredClone(current);
    mocks.update.mockImplementationOnce(async ({ data }) => {
      current.consentSnapshot = structuredClone(data.consentSnapshot);
      vi.setSystemTime(new Date(now.getTime() + 1001));
      return current;
    });
    expect((await POST(request(input), ctx)).status).toBe(409);
    expect(current).toEqual(before);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([
    { entries: 'broken', notes: null },
    { entries: [], notes: null, unknownHistory: [] },
    {
      entries: [{ scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', ackedAt: 'bad-date' }],
      notes: null,
    },
  ])('fails closed on malformed history without dropping it', async (snapshot) => {
    current.consentSnapshot = snapshot;
    expect((await GET(request(), ctx)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('bounds growth without truncating existing consent history', async () => {
    current.consentSnapshot = {
      entries: Array.from({ length: MAX_RECOVERY_SNAPSHOT_ENTRIES }, () => ({
        scope: 'AUDIO_RECORDING',
        scriptVersion: 'v1.0',
        ackedAt: '2026-09-08T10:00:00Z',
      })),
      notes: null,
    };
    const input = await postInput();
    const response = await POST(request(input), ctx);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('support review');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
