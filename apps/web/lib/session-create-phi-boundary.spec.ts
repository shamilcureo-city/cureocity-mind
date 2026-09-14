import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  client: vi.fn(),
  practitioner: vi.fn(),
  initialSession: vi.fn(),
  candidates: vi.fn(),
  query: vi.fn(),
  advisory: vi.fn(),
  lockedSession: vi.fn(),
  create: vi.fn(),
  episode: vi.fn(),
  createEpisode: vi.fn(),
  closeout: vi.fn(),
  audit: vi.fn(),
  billing: vi.fn(),
  enforced: vi.fn(),
  defaults: vi.fn(),
  template: vi.fn(),
  token: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.client },
    psychologist: { findUnique: mocks.practitioner },
    session: { findFirst: mocks.initialSession, findMany: mocks.candidates },
    noteTemplate: { findFirst: mocks.template },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./billing', () => ({ getEntitlement: mocks.billing, isBillingEnforced: mocks.enforced }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./mappers', () => ({ toSession: (row: unknown) => row }));
vi.mock('./session-defaults', () => ({
  computeSessionDefaults: mocks.defaults,
  modalityWasOverridden: () => false,
  SessionDefaultsError: class extends Error {},
}));
vi.mock('./clinic-queue', () => ({
  istDayRange: () => ({
    start: new Date('2099-09-07T00:00:00Z'),
    end: new Date('2099-09-08T00:00:00Z'),
  }),
  nextClinicToken: mocks.token,
}));
import { POST } from '../app/api/v1/sessions/route';

const CLIENT = 'cm00000000000000000000001';
const SOURCE = 'cm00000000000000000000002';
const CREATED = 'cm00000000000000000000003';
const FOLLOW_UP = 'cm00000000000000000000004';
const OWNER = 'psy-1';
const scheduledAt = '2099-09-07T10:00:00.000Z';
const tx = {
  $queryRaw: mocks.query,
  $executeRaw: mocks.advisory,
  session: {
    findFirst: mocks.lockedSession,
    findUnique: mocks.lockedSession,
    create: mocks.create,
  },
  treatmentEpisode: { findFirst: mocks.episode, create: mocks.createEpisode },
  mindSessionCloseoutState: { upsert: mocks.closeout },
};
const call = (extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('https://example.test/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT, scheduledAt, ...extra }),
    }),
  );
let events: string[];
function useDoctor() {
  const auth = { ok: true, value: { psychologistId: OWNER, user: { vertical: 'DOCTOR' } } };
  mocks.auth.mockResolvedValue(auth);
  mocks.practitioner.mockResolvedValue({ vertical: 'DOCTOR' });
}
function sourceReceipt(followUpSessionId: string | null) {
  mocks.initialSession.mockResolvedValue({ id: SOURCE, mindCloseout: { followUpSessionId } });
  mocks.lockedSession.mockImplementation(async ({ where }) =>
    where.id === SOURCE
      ? { mindCloseout: { followUpSessionId } }
      : { id: FOLLOW_UP, clientId: CLIENT, psychologistId: OWNER, status: 'SCHEDULED' },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  events = [];
  const auth = { ok: true, value: { psychologistId: OWNER, user: { vertical: 'THERAPIST' } } };
  mocks.auth.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.client.mockResolvedValue({
    id: CLIENT,
    psychologistId: OWNER,
    deletedAt: null,
    isDemo: false,
  });
  mocks.practitioner.mockResolvedValue({ vertical: 'THERAPIST' });
  mocks.candidates.mockResolvedValue([]);
  mocks.enforced.mockReturnValue(false);
  mocks.template.mockResolvedValue({ id: 'template-1' });
  mocks.defaults.mockResolvedValue({
    kind: 'TREATMENT',
    modality: 'CBT',
    language: 'en',
    modalitySource: 'CLIENT',
  });
  mocks.transaction.mockImplementation((run) => run(tx));
  // Exercise the real PHI helper and its tagged SQL, not a mocked lock function.
  mocks.query.mockImplementation(async (sql: TemplateStringsArray) => {
    const clientLock = Array.from(sql).join('?').includes('FROM "clients" c');
    events.push(clientLock ? 'client-lock' : 'session-lock');
    return clientLock ? [{ id: CLIENT, psychologistId: OWNER }] : [{ id: SOURCE }];
  });
  mocks.advisory.mockImplementation(async () => {
    events.push('source-advisory');
    return 1;
  });
  mocks.token.mockImplementation(async () => {
    events.push('token');
    return 7;
  });
  mocks.create.mockImplementation(async ({ data }) => {
    events.push('session-create');
    return { id: CREATED, ...data };
  });
  mocks.episode.mockResolvedValue(null);
  mocks.createEpisode.mockImplementation(async () => {
    events.push('episode-create');
    return { id: 'episode-1' };
  });
  mocks.audit.mockImplementation(async () => {
    events.push('audit');
  });
});

describe('session create active-client transaction boundary', () => {
  it.each(['THERAPIST', 'DOCTOR'])(
    'creates an owned %s booking only after the active-client lock, without starting capture',
    async (vertical) => {
      if (vertical === 'DOCTOR') useDoctor();
      const response = await call({ language: 'ml' });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        id: CREATED,
        status: 'SCHEDULED',
        language: 'ml',
      });
      expect(events[0]).toBe('client-lock');
      expect(events.indexOf('session-create')).toBeGreaterThan(events.indexOf('client-lock'));
      const data = mocks.create.mock.calls[0]![0].data;
      expect(data).not.toHaveProperty('consentSnapshot');
      expect(data).not.toHaveProperty('startedAt');
      expect(data).not.toHaveProperty('captureMode');
      if (vertical === 'DOCTOR') {
        expect(data.tokenNumber).toBe(7);
        expect(mocks.token).toHaveBeenCalledWith(tx, OWNER, new Date(scheduledAt));
        expect(events.indexOf('token')).toBeGreaterThan(events.indexOf('client-lock'));
      } else {
        expect(mocks.token).not.toHaveBeenCalled();
        expect(data).not.toHaveProperty('tokenNumber');
      }
      const [sql, ...parameters] = mocks.query.mock.calls[0]!;
      expect(Array.from(sql as TemplateStringsArray).join('?')).toContain('c."deletedAt" IS NULL');
      expect(Array.from(sql as TemplateStringsArray).join('?')).toContain('FOR UPDATE OF c');
      expect(parameters).toEqual([CLIENT]);
    },
  );
  it.each(['erased', 'reassigned'])(
    'rejects a client %s after initial lookup before any session, episode, token or audit write',
    async (change) => {
      useDoctor();
      mocks.query.mockResolvedValue(
        change === 'erased' ? [] : [{ id: CLIENT, psychologistId: 'another' }],
      );
      const response = await call();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Client not found' });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.createEpisode).not.toHaveBeenCalled();
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );
  it('waits for the client lock and fails when erasure wins while that lock is pending', async () => {
    let entered!: () => void;
    let release!: () => void;
    const atLock = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const erased = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.query.mockImplementation(async () => {
      entered();
      await erased;
      return [];
    });
    const pending = call();
    await atLock;
    expect(mocks.create).not.toHaveBeenCalled();
    release();
    expect((await pending).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createEpisode).not.toHaveBeenCalled();
  });
  it('preserves ordinary scheduling rather than selecting another open same-day booking', async () => {
    expect((await call()).status).toBe(201);
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it('still refuses new sessions at the trial cap before opening a write transaction', async () => {
    mocks.enforced.mockReturnValue(true);
    mocks.billing.mockResolvedValue({ isPaidActive: false, trialUsed: 10, trialCap: 10 });
    expect((await call()).status).toBe(402);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('reuses an existing Scribe booking with its token before billing without creating a replacement', async () => {
    useDoctor();
    const row = {
      id: FOLLOW_UP,
      clientId: CLIENT,
      psychologistId: OWNER,
      status: 'IN_PROGRESS',
      scheduledAt: new Date(scheduledAt),
      tokenNumber: 4,
    };
    mocks.candidates.mockResolvedValue([row]);
    mocks.lockedSession.mockResolvedValue(row);
    expect(await (await call({ startNow: true })).json()).toMatchObject({
      id: FOLLOW_UP,
      tokenNumber: 4,
    });
    expect(mocks.billing).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });
});

describe('follow-up receipt ownership and erasure rechecks', () => {
  it('returns an existing owned follow-up before billing, preserving the receipt and date', async () => {
    sourceReceipt(FOLLOW_UP);
    expect(await (await call({ sourceSessionId: SOURCE })).json()).toMatchObject({ id: FOLLOW_UP });
    expect(events.slice(0, 3)).toEqual(['client-lock', 'source-advisory', 'session-lock']);
    expect(mocks.lockedSession).toHaveBeenCalledWith({
      where: { id: FOLLOW_UP, clientId: CLIENT, psychologistId: OWNER },
    });
    expect(mocks.billing).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.closeout).not.toHaveBeenCalled();
  });
  it.each(['erased', 'reassigned'])(
    'does not disclose a stale follow-up receipt after the client is %s',
    async (change) => {
      sourceReceipt(FOLLOW_UP);
      mocks.query.mockResolvedValue(
        change === 'erased' ? [] : [{ id: CLIENT, psychologistId: 'another' }],
      );
      expect((await call({ sourceSessionId: SOURCE })).status).toBe(404);
      expect(mocks.lockedSession).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it('rejects a source session that no longer matches the owned completed source', async () => {
    sourceReceipt(null);
    mocks.lockedSession.mockResolvedValue(null);
    expect((await call({ sourceSessionId: SOURCE })).status).toBe(404);
    expect(mocks.lockedSession).toHaveBeenCalledWith({
      where: { id: SOURCE, clientId: CLIENT, psychologistId: OWNER, status: 'COMPLETED' },
      select: { mindCloseout: { select: { followUpSessionId: true } } },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.closeout).not.toHaveBeenCalled();
  });
  it('fails closed when a follow-up link no longer resolves to the same client and owner', async () => {
    sourceReceipt(FOLLOW_UP);
    mocks.lockedSession
      .mockResolvedValueOnce({ mindCloseout: { followUpSessionId: FOLLOW_UP } })
      .mockResolvedValueOnce(null);
    expect((await call({ sourceSessionId: SOURCE })).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('honors a receipt that appeared before the locked creation check without minting another visit', async () => {
    sourceReceipt(FOLLOW_UP);
    mocks.initialSession.mockResolvedValue({
      id: SOURCE,
      mindCloseout: { followUpSessionId: null },
    });
    const response = await call({ sourceSessionId: SOURCE });
    // Preserve the existing create-path response status for a concurrently discovered receipt.
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: FOLLOW_UP });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.closeout).not.toHaveBeenCalled();
  });
  it('creates and links a follow-up after Client, source advisory and source session locks', async () => {
    sourceReceipt(null);
    expect((await call({ sourceSessionId: SOURCE })).status).toBe(201);
    expect(events.slice(0, 4)).toEqual([
      'client-lock',
      'source-advisory',
      'session-lock',
      'session-create',
    ]);
    expect(mocks.closeout).toHaveBeenCalledWith({
      where: { sessionId: SOURCE },
      create: { sessionId: SOURCE, followUpSessionId: CREATED },
      update: { followUpSessionId: CREATED, followUpSkippedAt: null },
    });
  });
});
