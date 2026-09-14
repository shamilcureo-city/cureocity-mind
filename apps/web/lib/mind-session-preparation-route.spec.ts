import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  session: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  enabled: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: m.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: m.audit }));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: m.encrypt, decryptForTenant: m.decrypt }));
vi.mock('./mind-session-preparation-feature', () => ({
  isMindSessionPreparationEnabled: m.enabled,
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: m.transaction } }));
import { GET, POST } from '../app/api/v1/sessions/[id]/preparation/route';
import {
  MindSessionPreparationUnreadableError,
  toMindSessionPreparationDto,
} from './mind-session-preparation';

const scheduledAt = '2026-09-13T09:00:00.000Z';
const operationId = 'b59c1dcb-3be9-48c6-aa57-5f8007439375';
const otherOperationId = '42ed94db-c64f-43ea-9df7-4d594305c1f5';
const input = {
  operationId,
  expectedClientId: 'client-1',
  expectedRevision: 0,
  expectedScheduledAt: scheduledAt,
  action: 'SAVE',
  focus: 'Fictional clinician-authored visit focus',
};
const body = {
  version: 1,
  focus: input.focus,
  source: 'CLINICIAN_WRITTEN',
  scheduledAt,
};
const context = (id = 'visit-1') => ({ params: Promise.resolve({ id }) });
const req = (method: string, payload?: unknown, id = 'visit-1') =>
  new Request(`https://example.test/api/v1/sessions/${id}/preparation`, {
    method,
    ...(payload !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
      : {}),
  }) as never;
const save = (payload: unknown = input, id = 'visit-1') =>
  POST(req('POST', payload, id), context(id));
const read = (id = 'visit-1') => GET(req('GET', undefined, id), context(id));
type Row = {
  id: string;
  sessionId: string;
  psychologistId: string;
  revision: number;
  operationId: string;
  bodyEncrypted: string;
  createdAt: Date;
};
let rows: Row[];
let session: {
  id: string;
  clientId: string;
  psychologistId: string;
  scheduledAt: Date;
  status: string;
};
let encrypted: Map<string, string>;
let clientErased: boolean;
let events: string[];

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  events = [];
  clientErased = false;
  encrypted = new Map();
  session = {
    id: 'visit-1',
    clientId: 'client-1',
    psychologistId: 'psy-1',
    scheduledAt: new Date(scheduledAt),
    status: 'SCHEDULED',
  };
  m.enabled.mockReturnValue(true);
  m.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  m.query.mockImplementation(async (parts: TemplateStringsArray) => {
    if (parts.join('').includes('FOR UPDATE OF c')) {
      events.push('client-lock');
      return clientErased ? [] : [{ id: 'client-1', psychologistId: 'psy-1' }];
    }
    events.push('session-lock');
    return [{ id: session.id }];
  });
  m.session.mockImplementation(async () => {
    events.push('session-reread');
    return session;
  });
  m.encrypt.mockImplementation(async (_owner: string, plaintext: string) => {
    events.push('encrypt');
    const cipher = `opaque-envelope-${encrypted.size}`;
    encrypted.set(cipher, plaintext);
    return cipher;
  });
  m.decrypt.mockImplementation(
    async (_owner: string, cipher: string) => encrypted.get(cipher) ?? null,
  );
  m.read.mockImplementation(async ({ where }: { where: Partial<Row> }) => {
    events.push('preparation-read');
    return (
      rows
        .filter((row) =>
          Object.entries(where).every(([key, value]) => row[key as keyof Row] === value),
        )
        .sort((a, b) => b.revision - a.revision)[0] ?? null
    );
  });
  m.create.mockImplementation(async ({ data }) => {
    events.push('preparation-create');
    const row = {
      ...data,
      id: `preparation-${rows.length + 1}`,
      createdAt: new Date('2026-09-13T08:00:00Z'),
    };
    rows.push(row);
    return row;
  });
  let tail = Promise.resolve();
  // This intentionally models serialized lifecycle-lock transactions, not PostgreSQL.
  m.transaction.mockImplementation(async (fn) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const before = structuredClone(rows);
    try {
      return await fn({
        $queryRaw: m.query,
        session: { findUnique: m.session },
        mindSessionPreparation: { findFirst: m.read, create: m.create },
      });
    } catch (error) {
      rows = before;
      throw error;
    } finally {
      release();
    }
  });
});

describe('exact-visit preparation authorization and persistence', () => {
  it('saves only the explicit focus encrypted after Client -> Session lock and owner reread', async () => {
    const response = await save();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      sessionId: 'visit-1',
      clientId: 'client-1',
      scheduledAt,
      status: 'SCHEDULED',
      preparation: { revision: 1, operationId, body },
      currentRevision: 1,
      replayed: false,
    });
    expect(events).toEqual([
      'client-lock',
      'session-lock',
      'session-reread',
      'preparation-read',
      'preparation-read',
      'encrypt',
      'preparation-create',
    ]);
    expect(m.encrypt).toHaveBeenCalledWith('psy-1', JSON.stringify(body));
    expect(JSON.stringify(rows)).not.toContain(input.focus);
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain(input.focus);
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MIND_SESSION_PREPARATION_SAVED',
        metadata: expect.objectContaining({
          sessionId: 'visit-1',
          revision: 1,
          operation: 'SAVE',
          source: 'CLINICIAN_WRITTEN',
        }),
      }),
      expect.anything(),
    );
    // No note, consent, audio, AI-context, therapy or session updater is provided to the transaction.
    expect(m.create).toHaveBeenCalledOnce();
  });

  it('reads no preparation as null without synthesizing a record', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessionId: 'visit-1', preparation: null });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.encrypt).not.toHaveBeenCalled();
  });

  it('keeps two visits on the same day distinct', async () => {
    await save();
    session = { ...session, id: 'visit-2', scheduledAt: new Date('2026-09-13T10:00:00Z') };
    const second = await save(
      {
        ...input,
        expectedScheduledAt: session.scheduledAt.toISOString(),
        focus: 'Different fictional focus',
      },
      'visit-2',
    );
    expect(second.status).toBe(201);
    expect(rows.map((row) => [row.sessionId, row.revision])).toEqual([
      ['visit-1', 1],
      ['visit-2', 1],
    ]);
    expect((await (await read('visit-2')).json()).preparation.body.focus).toBe(
      'Different fictional focus',
    );
    session = { ...session, id: 'visit-1', scheduledAt: new Date(scheduledAt) };
    expect((await (await read()).json()).preparation.body.focus).toBe(input.focus);
  });

  it('appends explicit clears while retaining the earlier encrypted focus', async () => {
    await save();
    const response = await save({
      ...input,
      operationId: otherOperationId,
      expectedRevision: 1,
      action: 'CLEAR',
      focus: null,
    });
    expect(response.status).toBe(201);
    expect((await response.json()).preparation.body.focus).toBeNull();
    expect(rows).toHaveLength(2);
    expect((await toMindSessionPreparationDto(rows[0]!)).body.focus).toBe(input.focus);
    expect((await (await read()).json()).preparation.body.focus).toBeNull();
  });

  it('requires documentation capability only, not therapy-guide entitlement', async () => {
    await save();
    expect(m.auth.mock.calls.map((call) => call[1])).toEqual(['BEHAVIORAL_HEALTH_DOCUMENTATION']);
  });

  it.each([401, 403])('preserves private auth failure %s without reading PHI', async (status) => {
    m.auth.mockResolvedValue({ ok: false, response: new Response('{}', { status }) });
    for (const response of [await read(), await save()]) {
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('rejects Doctor vertical even if the capability call succeeds', async () => {
    m.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'psy-1', user: { vertical: 'DOCTOR' } },
    });
    expect((await read()).status).toBe(404);
    expect((await save()).status).toBe(404);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it.each([
    'session-owner',
    'client-owner',
    'session-client-link',
    'session-missing',
    'session-id',
  ])('fails closed for changed %s', async (boundary) => {
    if (boundary === 'session-owner') session.psychologistId = 'other';
    if (boundary === 'client-owner')
      m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'other' }]);
    if (boundary === 'session-client-link') session.clientId = 'client-2';
    if (boundary === 'session-missing') m.session.mockResolvedValue(null);
    if (boundary === 'session-id') session.id = 'different-visit';
    expect((await read()).status).toBe(404);
    expect((await save()).status).toBe(404);
    expect(m.read).not.toHaveBeenCalled();
    expect(m.encrypt).not.toHaveBeenCalled();
  });

  it('denies a new write and a successful-operation replay after erasure wins the Client lock', async () => {
    await save();
    clientErased = true;
    const creates = m.create.mock.calls.length;
    expect((await save()).status).toBe(404);
    expect(
      (await save({ ...input, operationId: otherOperationId, expectedRevision: 1 })).status,
    ).toBe(404);
    expect((await read()).status).toBe(404);
    expect(m.create).toHaveBeenCalledTimes(creates);
  });

  it('refuses a stale client identity before reading receipts or saving after linkage changed before locking', async () => {
    await save();
    session.clientId = 'client-2';
    m.query.mockImplementation(async (parts: TemplateStringsArray) => {
      if (parts.join('').includes('FOR UPDATE OF c'))
        return [{ id: 'client-2', psychologistId: 'psy-1' }];
      return [{ id: session.id }];
    });
    m.read.mockClear();
    expect((await save()).status).toBe(404);
    expect(
      (await save({ ...input, operationId: otherOperationId, expectedRevision: 1 })).status,
    ).toBe(404);
    expect(m.read).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('serializes the write before a queued erasure and rejects all subsequent saves', async () => {
    const pending = save();
    // Let auth/parse enter the transaction before simulating erasure using its same queue.
    await vi.waitFor(() => expect(m.transaction).toHaveBeenCalledOnce());
    const erasure = m.transaction(async () => {
      clientErased = true;
      rows = [];
    });
    expect((await pending).status).toBe(201);
    await erasure;
    expect(rows).toEqual([]);
    expect((await save()).status).toBe(404);
  });

  it('keeps authorized reads usable when new editing is disabled', async () => {
    await save();
    m.enabled.mockReturnValue(false);
    const readResponse = await read();
    expect(readResponse.status).toBe(200);
    expect((await readResponse.json()).preparation.body).toEqual(body);
    const writes = m.create.mock.calls.length;
    expect((await save()).status).toBe(503);
    expect(m.create).toHaveBeenCalledTimes(writes);
  });
});

describe('preparation operation receipts and conflicts', () => {
  it('acknowledges a lost successful response without duplicate rows or audits', async () => {
    await save();
    const retry = await save();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      preparation: { revision: 1 },
      currentRevision: 1,
      replayed: true,
    });
    expect(rows).toHaveLength(1);
    expect(m.audit).toHaveBeenCalledOnce();
    expect(m.encrypt).toHaveBeenCalledOnce();
  });

  it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])(
    'acknowledges the exact old save in %s but rejects a new save',
    async (status) => {
      await save();
      session.status = status;
      expect((await save()).status).toBe(200);
      expect(
        (await save({ ...input, operationId: otherOperationId, expectedRevision: 1 })).status,
      ).toBe(409);
      expect(rows).toHaveLength(1);
    },
  );

  it('rejects stale scheduled identity while permitting exact receipt replay after rescheduling', async () => {
    await save();
    session.scheduledAt = new Date('2026-09-14T09:00:00Z');
    const replay = await save();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      scheduledAt: '2026-09-14T09:00:00.000Z',
      preparation: { body: { scheduledAt } },
    });
    expect(
      (await save({ ...input, operationId: otherOperationId, expectedRevision: 1 })).status,
    ).toBe(409);
  });

  it.each([
    { focus: 'A different focus' },
    { expectedRevision: 1 },
    { expectedScheduledAt: '2026-09-14T09:00:00.000Z' },
    { action: 'CLEAR', focus: null },
  ])('rejects a reused operation ID with different canonical input %j', async (change) => {
    await save();
    expect((await save({ ...input, ...change })).status).toBe(409);
    expect(rows).toHaveLength(1);
  });

  it('normalizes equivalent ISO timestamps and trimmed focus for replay', async () => {
    await save({
      ...input,
      expectedScheduledAt: '2026-09-13T14:30:00+05:30',
      focus: `  ${input.focus}  `,
    });
    expect((await save()).status).toBe(200);
    expect(rows).toHaveLength(1);
  });

  it('returns original receipt and current revision without rolling later preparation back', async () => {
    await save();
    await save({
      ...input,
      expectedRevision: 1,
      operationId: otherOperationId,
      focus: 'Newer fictional focus',
    });
    const retry = await save();
    expect(await retry.json()).toMatchObject({
      preparation: { revision: 1, body },
      currentRevision: 2,
      replayed: true,
    });
    expect((await (await read()).json()).preparation.revision).toBe(2);
  });

  it('serializes independent simultaneous saves and rejects the stale draft', async () => {
    const responses = await Promise.all([
      save(),
      save({ ...input, operationId: otherOperationId }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 409]);
    expect(rows).toHaveLength(1);
  });
});

describe('preparation fail-closed storage and validation', () => {
  it.each([
    null,
    '{bad json',
    JSON.stringify({ ...body, version: 2 }),
    JSON.stringify({ ...body, focus: 'x'.repeat(201) }),
  ])(
    'does not overwrite or present unreadable ciphertext as an empty record: %j',
    async (plaintext) => {
      await save();
      m.decrypt.mockResolvedValue(plaintext);
      expect((await read()).status).toBe(503);
      expect(
        (await save({ ...input, operationId: otherOperationId, expectedRevision: 1 })).status,
      ).toBe(503);
      expect((await save()).status).toBe(503);
      expect(rows).toHaveLength(1);
    },
  );

  it('blocks an old receipt if a newer current revision is unreadable', async () => {
    await save();
    await save({
      ...input,
      operationId: otherOperationId,
      expectedRevision: 1,
      focus: 'New focus',
    });
    encrypted.delete(rows[1]!.bodyEncrypted);
    expect((await save()).status).toBe(503);
    expect(rows).toHaveLength(2);
  });

  it('validates stored owner before decrypting a malformed historical row', async () => {
    await save();
    rows[0]!.psychologistId = 'other-owner';
    m.decrypt.mockClear();
    expect((await read()).status).toBe(503);
    expect(m.decrypt).not.toHaveBeenCalled();
  });

  it('sanitizes thrown crypto failures', async () => {
    await save();
    m.decrypt.mockRejectedValue(new Error('raw crypto detail with fictional private text'));
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('raw crypto');
    await expect(toMindSessionPreparationDto(rows[0]!)).rejects.toBeInstanceOf(
      MindSessionPreparationUnreadableError,
    );
  });

  it('returns a private unavailable response for an absent table, not a false empty record', async () => {
    m.read.mockRejectedValue({ code: 'P2021', message: 'missing secret table detail' });
    for (const response of [await read(), await save()]) {
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).not.toContain('secret table');
    }
    expect(m.create).not.toHaveBeenCalled();
  });

  it('rolls back the preparation if audit persistence fails and allows safe exact retry', async () => {
    m.audit.mockRejectedValueOnce(new Error('audit failure'));
    expect((await save()).status).toBe(503);
    expect(rows).toHaveLength(0);
    expect((await save()).status).toBe(201);
    expect(rows).toHaveLength(1);
  });

  it.each([
    { consentGranted: true },
    { body: { focus: 'unexpected alternate body' } },
    { operationId: 'not-a-uuid' },
    { expectedClientId: '' },
    { expectedRevision: -1 },
    { expectedRevision: 2_147_483_647 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { expectedScheduledAt: 'invalid date' },
    { focus: 'x'.repeat(201) },
    { focus: ' ' },
    { action: 'SAVE', focus: null },
    { action: 'CLEAR', focus: 'must be explicit null' },
  ])('rejects invalid bounded input without acquiring locks: %j', async (change) => {
    const response = await save({ ...input, ...change });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('returns private 400 for malformed JSON', async () => {
    const request = new Request('https://example.test/api/v1/sessions/visit-1/preparation', {
      method: 'POST',
      body: '{',
    });
    const response = await POST(request as never, context());
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('sets privacy headers on success and conflict as well', async () => {
    for (const response of [
      await save(),
      await read(),
      await save({ ...input, expectedRevision: 1 }),
    ]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });
});
