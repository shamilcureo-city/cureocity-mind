import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindCareRecordBodySchema } from '@cureocity/contracts';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  client: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: m.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: m.audit }));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: m.encrypt, decryptForTenant: m.decrypt }));
vi.mock('./prisma', () => ({
  prisma: { client: { findFirst: m.client }, $transaction: m.transaction },
}));
import { GET, POST } from '../app/api/v1/clients/[id]/care-record/route';

const body = MindCareRecordBodySchema.parse({
  version: 'V1',
  agreement: {
    scope: 'Fictional counselling priorities',
    clientPriorities: 'Fictional client wants more confidence',
    confidentialityAndLimits: '',
    practicalArrangements: '',
    contactAndCrisisArrangements: '',
    discussedOn: '2026-09-10',
    reviewOn: null,
  },
  clientVoice: {
    recordedOn: null,
    whatHelped: '',
    whatCouldChange: '',
    everydayChanges: '',
    clinicianReflection: '',
  },
  continuity: {
    stage: 'NOT_PLANNED',
    maintenancePlan: '',
    warningSignsAndResponse: '',
    endingOrReferralPlan: '',
    referralFollowThrough: '',
    reviewOn: null,
  },
});
const input = { expectedVersion: 0, operationId: 'b59c1dcb-3be9-48c6-aa57-5f8007439375', body };
const context = { params: Promise.resolve({ id: 'client-1' }) };
const req = (method: string, payload?: unknown, query = '') =>
  new Request(`https://example.test/api/v1/clients/client-1/care-record${query}`, {
    method,
    ...(payload
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
      : {}),
  }) as never;
const save = (payload: unknown = input) => POST(req('POST', payload), context);
type Row = {
  id: string;
  clientId: string;
  psychologistId: string;
  version: number;
  operationId: string;
  bodyEncrypted: string;
  createdAt: Date;
};
let rows: Row[];

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  m.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  m.client.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
  const encrypted = new Map<string, string>();
  m.encrypt.mockImplementation(async (_owner: string, plaintext: string) => {
    const cipher = `opaque-envelope-${encrypted.size}`;
    encrypted.set(cipher, plaintext);
    return cipher;
  });
  m.decrypt.mockImplementation(
    async (_owner: string, cipher: string) => encrypted.get(cipher) ?? null,
  );
  m.read.mockImplementation(
    async ({ where }: { where: Partial<Row> }) =>
      rows
        .filter((row) =>
          Object.entries(where).every(([key, value]) => row[key as keyof Row] === value),
        )
        .sort((a, b) => b.version - a.version)[0] ?? null,
  );
  m.create.mockImplementation(async ({ data }) => {
    const row = {
      ...data,
      id: `record-${rows.length + 1}`,
      createdAt: new Date('2026-09-10T10:00:00Z'),
    };
    rows.push(row);
    return row;
  });
  let tail = Promise.resolve();
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
        client: { findFirst: m.client },
        clientMindCareRecord: { findFirst: m.read, create: m.create },
      });
    } catch (error) {
      rows = before;
      throw error;
    } finally {
      release();
    }
  });
});

describe('encrypted clinician-authored care record', () => {
  it('encrypts every clinical field and audits metadata only', async () => {
    const response = await save();
    expect(response.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bodyEncrypted).toBe('opaque-envelope-0');
    expect(JSON.stringify(rows)).not.toContain('Fictional');
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('Fictional');
    expect(m.encrypt).toHaveBeenCalledWith('psy-1', JSON.stringify(body));
    expect((await response.json()).record.body).toEqual(body);
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MIND_CARE_RECORD_SAVED',
        metadata: expect.objectContaining({ version: 1 }),
      }),
      expect.anything(),
    );
  });
  it('returns the same receipt after a lost reply without duplicating versions or audits', async () => {
    await save();
    const retry = await save();
    expect(retry.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it('does not accept another body or expected version under a reused save identifier', async () => {
    await save();
    expect(
      (
        await save({
          ...input,
          body: { ...body, agreement: { ...body.agreement, scope: 'Other scope' } },
        })
      ).status,
    ).toBe(409);
    expect((await save({ ...input, expectedVersion: 1 })).status).toBe(409);
    expect(rows).toHaveLength(1);
  });
  it('serializes simultaneous saves and rejects a stale independent save', async () => {
    const responses = await Promise.all([
      save(),
      save({ ...input, operationId: '42ed94db-c64f-43ea-9df7-4d594305c1f5' }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 409]);
    expect(rows).toHaveLength(1);
  });
  it('keeps previous versions readable after a clinician-authored amendment', async () => {
    await save();
    const changed = {
      ...body,
      clientVoice: {
        ...body.clientVoice,
        whatHelped: 'The fictional client reported a useful conversation',
      },
    };
    await save({
      expectedVersion: 1,
      operationId: '42ed94db-c64f-43ea-9df7-4d594305c1f5',
      body: changed,
    });
    const previous = await GET(req('GET', undefined, '?version=1'), context);
    expect(await previous.json()).toMatchObject({ latestVersion: 2, record: { version: 1, body } });
    expect(rows).toHaveLength(2);
  });
  it('returns an old lost receipt without rolling the current record backwards', async () => {
    await save();
    await save({
      ...input,
      expectedVersion: 1,
      operationId: '42ed94db-c64f-43ea-9df7-4d594305c1f5',
    });
    const retry = await save();
    expect(await retry.json()).toMatchObject({ latestVersion: 2, record: { version: 1 } });
    expect(rows).toHaveLength(2);
  });
  it.each(['PAUSED', 'DISCHARGED', 'TRANSFERRED'])(
    'allows documentation-only follow-through for %s care without changing its status',
    async (status) => {
      m.client.mockResolvedValue({ id: 'client-1', status });
      expect((await save()).status).toBe(201);
      // The transaction deliberately offers no client/episode update operation.
      expect(rows).toHaveLength(1);
    },
  );
  it('fails closed when erasure wins after encryption', async () => {
    m.query.mockResolvedValue([]);
    expect((await save()).status).toBe(404);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('does not disclose or save another owner’s client', async () => {
    m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'other' }]);
    expect((await GET(req('GET'), context)).status).toBe(404);
    expect((await save()).status).toBe(404);
  });
  it('does not overwrite unreadable encrypted history or present it as empty', async () => {
    await save();
    m.decrypt.mockResolvedValue(null);
    expect((await GET(req('GET'), context)).status).toBe(503);
    expect(
      (
        await save({
          ...input,
          expectedVersion: 1,
          operationId: '42ed94db-c64f-43ea-9df7-4d594305c1f5',
        })
      ).status,
    ).toBe(503);
    expect(rows).toHaveLength(1);
  });
  it('rolls back the new version when the clinical audit cannot be saved', async () => {
    m.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(save()).rejects.toThrow('audit unavailable');
    expect(rows).toHaveLength(0);
  });
  it('rejects Doctor access before reading or encrypting client context', async () => {
    m.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor', user: { vertical: 'DOCTOR' } },
    });
    expect((await save()).status).toBe(404);
    expect((await GET(req('GET'), context)).status).toBe(404);
    expect(m.encrypt).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
  });
  it('checks documentation capability separately from therapy workflow capability', async () => {
    m.auth.mockImplementation(async (_req, capability) =>
      capability === 'BEHAVIORAL_HEALTH_DOCUMENTATION'
        ? { ok: false, response: new Response('{}', { status: 403 }) }
        : { ok: true, value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } } },
    );
    expect((await save()).status).toBe(403);
    expect(m.client).not.toHaveBeenCalled();
  });
  it('rejects unknown fields that could imply consent/discharge and excessive free text', async () => {
    expect((await save({ ...input, body: { ...body, consentGranted: true } })).status).toBe(400);
    expect(
      (
        await save({
          ...input,
          body: { ...body, agreement: { ...body.agreement, scope: 'a'.repeat(2001) } },
        })
      ).status,
    ).toBe(400);
    expect(rows).toHaveLength(0);
  });
});
