import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from './sign-note-payload';
import {
  SCRIBE_BUILTIN_DOCTOR_TEMPLATES,
  ScribeDoctorTemplateSchema,
  ScribeDoctorTemplateResponseSchema,
  ScribeDoctorTemplatesResponseSchema,
  renderScribeDocumentTemplate,
  hasUnresolvedScribeTemplateFields,
  type ScribeDoctorTemplate,
} from './scribe-doctor-templates';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
  auditFindFirst: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.auth }));
vi.mock('./prisma', () => ({
  prisma: {
    $transaction: h.transaction,
    scribeWorkspaceRecord: { findFirst: h.findFirst, findMany: h.findMany },
  },
}));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: h.encrypt, decryptForTenant: h.decrypt }));
vi.mock('./audit', () => ({ writeAudit: h.audit }));
import { GET, POST } from '../app/api/v1/scribe/templates/route';
import { PATCH, DELETE } from '../app/api/v1/scribe/templates/[id]/route';

type Row = {
  id: string;
  revision: number;
  psychologistId: string;
  clientId: string | null;
  sessionId: string | null;
  kind: string;
  bodyEncrypted: string;
  createdAt: Date;
  updatedAt: Date;
};
let rows: Row[];
let ownerActive: boolean;
let delayedChange: (() => void) | null;
const tx = {
  $queryRaw: h.query,
  auditLog: { findFirst: h.auditFindFirst },
  scribeWorkspaceRecord: {
    findFirst: h.findFirst,
    findMany: h.findMany,
    count: h.count,
    create: h.create,
    updateMany: h.updateMany,
    deleteMany: h.deleteMany,
    findUniqueOrThrow: h.findUniqueOrThrow,
  },
};
const url = 'https://scribe.example.test/api/v1/scribe/templates';
const operationId = '11ca13f2-4563-4d97-a5f8-39b898fa0001';
const template: ScribeDoctorTemplate = {
  kind: 'document_skeleton',
  name: 'Fictional referral prompts',
  documentType: 'referral',
  prompts: ['recipient', 'referral_reason'],
};
const input = (override: Record<string, unknown> = {}) => ({
  operationId,
  template,
  containsNoPatientData: true,
  ...override,
});
const get = () => GET(new NextRequest(url));
const post = (body: unknown = input()) =>
  POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown, id = rows[0]?.id ?? 'missing') =>
  PATCH(new NextRequest(`${url}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const remove = (revision = rows[0]?.revision ?? 1, id = rows[0]?.id ?? 'missing') =>
  DELETE(
    new NextRequest(`${url}/${id}`, { method: 'DELETE', body: JSON.stringify({ revision }) }),
    { params: Promise.resolve({ id }) },
  );
const match = (row: Row, where: Record<string, unknown>) =>
  ['id', 'psychologistId', 'kind', 'clientId', 'sessionId', 'revision'].every(
    (key) => where[key] === undefined || row[key as keyof Row] === where[key],
  );
const saved = (row = rows[0]!) => JSON.parse(row.bodyEncrypted.slice('fixture:'.length));

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  ownerActive = true;
  delayedChange = null;
  h.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-a', user: { vertical: 'DOCTOR' } },
  });
  h.query.mockImplementation(async (strings: TemplateStringsArray) => {
    if (!strings.join('?').includes('FROM "psychologists"')) throw new Error('Unexpected SQL');
    return ownerActive ? [{ id: 'doctor-a' }] : [];
  });
  h.transaction.mockImplementation(async (fn) => fn(tx));
  h.auditFindFirst.mockImplementation(async ({ where }) => {
    const deleted = h.audit.mock.calls.some(
      ([entry]) =>
        entry.actorPsychologistId === where.actorPsychologistId &&
        entry.targetType === where.targetType &&
        entry.targetId === where.targetId &&
        entry.action === where.action &&
        entry.metadata?.kind === 'template' &&
        entry.metadata?.operation === 'delete',
    );
    return deleted ? { id: 'content-free-delete-audit' } : null;
  });
  h.findFirst.mockImplementation(
    async ({ where }) => rows.find((row) => match(row, where)) ?? null,
  );
  h.findMany.mockImplementation(async ({ where, take }) =>
    rows.filter((row) => match(row, where)).slice(0, take),
  );
  h.count.mockImplementation(async ({ where }) => rows.filter((row) => match(row, where)).length);
  h.create.mockImplementation(async ({ data }) => {
    if (rows.some((row) => row.id === data.id)) throw { code: 'P2002' };
    const row = { ...data, revision: 1, createdAt: new Date(), updatedAt: new Date() };
    rows.push(row);
    return row;
  });
  h.updateMany.mockImplementation(async ({ where, data }) => {
    const row = rows.find((item) => match(item, where));
    if (!row) return { count: 0 };
    row.bodyEncrypted = data.bodyEncrypted;
    row.revision += 1;
    return { count: 1 };
  });
  h.deleteMany.mockImplementation(async ({ where }) => {
    const index = rows.findIndex((item) => match(item, where));
    if (index < 0) return { count: 0 };
    rows.splice(index, 1);
    return { count: 1 };
  });
  h.findUniqueOrThrow.mockImplementation(async ({ where }) =>
    rows.find((row) => row.id === where.id),
  );
  h.encrypt.mockImplementation(async (_owner, text) => {
    delayedChange?.();
    delayedChange = null;
    return `fixture:${text}`;
  });
  h.decrypt.mockImplementation(async (_owner, ciphertext: string) =>
    ciphertext.slice('fixture:'.length),
  );
});

describe('doctor-owned reusable template API', () => {
  it('returns an empty private library only after locking an active doctor', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(ScribeDoctorTemplatesResponseSchema.parse(await response.json())).toEqual({
      records: [],
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const sql = h.query.mock.calls[0]![0].join('?');
    expect(sql).toContain('"status" = \'ACTIVE\'');
    expect(sql).toContain('FOR UPDATE');
    expect(h.query.mock.invocationCallOrder[0]).toBeLessThan(
      h.findMany.mock.invocationCallOrder[0]!,
    );
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          psychologistId: 'doctor-a',
          kind: 'template',
          clientId: null,
          sessionId: null,
        }),
        take: 51,
      }),
    );
  });
  it.each([401, 403])('enforces authentication/capability %i for every method', async (status) => {
    h.auth.mockImplementation(async () => ({ ok: false, response: Response.json({}, { status }) }));
    for (const response of [await get(), await post(), await patch({}), await remove()]) {
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.findFirst).not.toHaveBeenCalled();
  });
  it('does not expose a Scribe library to Mind practitioners', async () => {
    h.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor-a', user: { vertical: 'THERAPIST' } },
    });
    for (const response of [await get(), await post(), await patch({}), await remove()])
      expect(response.status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it('creates encrypted personal data with no patient linkage or clinical writes', async () => {
    const response = await post();
    const { record } = ScribeDoctorTemplateResponseSchema.parse(await response.json());
    expect(response.status).toBe(201);
    expect(record).toMatchObject({
      clientId: null,
      sessionId: null,
      revision: 1,
      body: { version: 1, operationId, template },
    });
    expect(record.body.createHash).toBe(
      createHash('sha256').update(canonicalJson(template)).digest('hex'),
    );
    expect(h.encrypt).toHaveBeenCalledWith('doctor-a', JSON.stringify(record.body));
    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'template',
        clientId: null,
        sessionId: null,
        bodyEncrypted: expect.stringContaining('fixture:'),
      }),
    });
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SCRIBE_WORKSPACE_UPDATED',
        metadata: { kind: 'template', operation: 'create', revision: 1 },
      }),
      tx,
    );
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(template.name);
  });
  it('replays the same operation without creating or auditing twice', async () => {
    const first = await (await post()).json();
    const retry = await post();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(first);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledTimes(1);
  });
  it('a replay after editing returns the current template without restoring original content', async () => {
    await post();
    const original = saved();
    const changed = { ...template, name: 'Changed name' };
    expect(
      (await patch({ revision: 1, template: changed, containsNoPatientData: true })).status,
    ).toBe(200);
    const response = await post();
    const { record } = await response.json();
    expect(record.revision).toBe(2);
    expect(record.body.template).toEqual(changed);
    expect(record.body.createHash).toBe(original.createHash);
    expect(record.body.operationId).toBe(operationId);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('rejects operation reuse for different initial content', async () => {
    await post();
    expect(
      (await post(input({ template: { ...template, name: 'Different request' } }))).status,
    ).toBe(409);
    expect(saved().template).toEqual(template);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('consumes a deleted create operation so delayed retries cannot resurrect a revision-1 row', async () => {
    await post();
    const id = rows[0]!.id;
    expect((await remove(1, id)).status).toBe(200);
    h.query.mockClear();
    h.auditFindFirst.mockClear();
    const retry = await post();
    expect(retry.status).toBe(409);
    expect(retry.headers.get('cache-control')).toBe('private, no-store');
    expect(rows).toEqual([]);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.auditFindFirst).toHaveBeenCalledWith({
      where: {
        actorPsychologistId: 'doctor-a',
        actorType: 'PSYCHOLOGIST',
        action: 'SCRIBE_WORKSPACE_UPDATED',
        targetType: 'ScribeWorkspaceRecord',
        targetId: id,
        AND: [
          { metadata: { path: ['kind'], equals: 'template' } },
          { metadata: { path: ['operation'], equals: 'delete' } },
        ],
      },
      select: { id: true },
    });
    expect(h.query.mock.invocationCallOrder[0]).toBeLessThan(
      h.auditFindFirst.mock.invocationCallOrder[0]!,
    );
    expect((await patch({ revision: 1, template, containsNoPatientData: true }, id)).status).toBe(
      404,
    );
    expect(
      (await post(input({ operationId: '11ca13f2-4563-4d97-a5f8-39b898fa0002' }))).status,
    ).toBe(201);
    expect(rows[0]!.id).not.toBe(id);
  });
  it('fails closed when deletion history cannot be checked', async () => {
    h.auditFindFirst.mockRejectedValue(new Error('audit unavailable: sensitive details'));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sensitive details');
    expect(h.create).not.toHaveBeenCalled();
  });
  it.each([false, undefined])(
    'requires explicit patient-data confirmation: %s',
    async (containsNoPatientData) => {
      expect((await post(input({ containsNoPatientData }))).status).toBe(400);
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...template, body: 'Automatic findings forbidden' },
    { ...template, prompts: ['clinician_statement'] },
    { ...template, prompts: ['recipient', 'recipient'] },
    { ...template, prompts: [] },
    { ...template, name: 'x'.repeat(81) },
  ])('rejects untrusted clinical defaults or malformed settings %#', async (bad) => {
    expect((await post(input({ template: bad }))).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('rejects supplied patient and server-owned metadata', async () => {
    expect((await post(input({ clientId: 'client-a' }))).status).toBe(400);
    expect((await post(input({ createHash: 'a'.repeat(64) }))).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('caps absent or dishonest content lengths and malformed JSON with private errors', async () => {
    for (const body of ['x'.repeat(65 * 1024), '{']) {
      const response = await POST(new NextRequest(url, { method: 'POST', body }));
      expect(response.status).toBe(body.length > 65536 ? 413 : 400);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it('rejects suspended or erased ownership before any list or edit data is returned', async () => {
    await post();
    ownerActive = false;
    h.findMany.mockClear();
    h.findFirst.mockClear();
    expect((await get()).status).toBe(403);
    expect((await patch({ revision: 1, template, containsNoPatientData: true })).status).toBe(403);
    expect((await remove()).status).toBe(403);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.findFirst).not.toHaveBeenCalled();
  });
  it('rechecks active ownership when persistence races suspension', async () => {
    await post();
    delayedChange = () => {
      ownerActive = false;
    };
    expect(
      (await patch({ revision: 1, template, containsNoPatientData: true })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(rows[0]!.revision).toBe(1);
  });
  it('isolates reads, edits, and deletes from another doctor or patient-bound corrupt scope', async () => {
    await post();
    const id = rows[0]!.id;
    rows[0]!.psychologistId = 'doctor-other';
    expect(await (await get()).json()).toEqual({ records: [] });
    expect((await patch({ revision: 1, template, containsNoPatientData: true }, id)).status).toBe(
      404,
    );
    expect((await remove(1, id)).status).toBe(404);
    rows[0]!.psychologistId = 'doctor-a';
    rows[0]!.clientId = 'client-a';
    expect(await (await get()).json()).toEqual({ records: [] });
    expect((await patch({ revision: 1, template, containsNoPatientData: true }, id)).status).toBe(
      404,
    );
  });
  it('enforces quota under the owner lock while permitting retries at the limit', async () => {
    await post();
    const first = rows[0]!;
    rows = Array.from({ length: 50 }, (_, i) => ({
      ...first,
      id: i === 0 ? first.id : `other-${i}`,
    }));
    expect((await post()).status).toBe(200);
    expect(
      (await post(input({ operationId: '11ca13f2-4563-4d97-a5f8-39b898fa0002' }))).status,
    ).toBe(409);
    expect(rows).toHaveLength(50);
  });
  it('never silently truncates a library larger than 50', async () => {
    await post();
    const first = rows[0]!;
    rows = Array.from({ length: 51 }, (_, i) => ({ ...first, id: `template-${i}` }));
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(template.name);
  });
  it('fails visibly on corrupted encrypted data or unavailable encryption without a plaintext fallback', async () => {
    await post();
    h.decrypt.mockResolvedValue(null);
    const read = await get();
    expect(read.status).toBe(503);
    expect(await read.text()).not.toContain('fixture');
    h.encrypt.mockResolvedValue(null);
    expect(
      (await post(input({ operationId: '11ca13f2-4563-4d97-a5f8-39b898fa0002' }))).status,
    ).toBe(503);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('rejects stale and predicted revisions before deriving a replacement', async () => {
    await post();
    for (const revision of [0, 2])
      expect((await patch({ revision, template, containsNoPatientData: true })).status).toBe(
        revision ? 409 : 400,
      );
    expect(h.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a revision that changes between read and write', async () => {
    await post();
    delayedChange = () => {
      rows[0]!.revision = 2;
    };
    expect(
      (
        await patch({
          revision: 1,
          template: { ...template, name: 'Do not replace' },
          containsNoPatientData: true,
        })
      ).status,
    ).toBe(409);
    expect(saved().template).toEqual(template);
  });
  it('deletes only the exact owner revision and audits no template text', async () => {
    await post();
    expect((await remove(2)).status).toBe(409);
    const id = rows[0]!.id;
    const response = await remove(1);
    expect(await response.json()).toEqual({ deletedId: id, revision: 1 });
    expect(rows).toEqual([]);
    expect(h.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id,
        revision: 1,
        psychologistId: 'doctor-a',
        kind: 'template',
        clientId: null,
        sessionId: null,
      }),
    });
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(template.name);
  });
});

describe('safe reusable content contracts', () => {
  it('keeps all seven note fields in both builtin layouts without patient note content', () => {
    expect(SCRIBE_BUILTIN_DOCTOR_TEMPLATES).toHaveLength(5);
    for (const item of SCRIBE_BUILTIN_DOCTOR_TEMPLATES) {
      expect(ScribeDoctorTemplateSchema.safeParse(item).success).toBe(true);
      if (item.kind === 'note_presentation')
        for (const profile of [item.style.firstVisit, item.style.followUp])
          expect(new Set(profile.order).size).toBe(7);
    }
  });
  it('renders only fixed completion prompts, never clinical assertions', () => {
    const doc = SCRIBE_BUILTIN_DOCTOR_TEMPLATES.find(
      (item) => item.kind === 'document_skeleton' && item.documentType === 'medical_certificate',
    )!;
    if (doc.kind !== 'document_skeleton') throw new Error('fixture');
    const rendered = renderScribeDocumentTemplate(doc);
    expect(rendered).toContain('[[Complete:');
    expect(rendered).not.toMatch(/fit for work|unfit|sick leave|2026/);
    expect(hasUnresolvedScribeTemplateFields(rendered)).toBe(true);
  });
  it.each([
    '[[Complete: Recipient]]',
    '[[ cOmPlEtE : custom text]]',
    '[[Complete',
    '[ [\nComplete: x',
    '［［Complete：x］］',
  ])('detects incomplete template markers: %s', (text) =>
    expect(hasUnresolvedScribeTemplateFields(text)).toBe(true),
  );
  it('does not confuse ordinary clinical prose with a template marker', () => {
    expect(
      hasUnresolvedScribeTemplateFields('Complete blood count requested. [Completed discussion]'),
    ).toBe(false);
  });
  it('uses an additive migration preserving all earlier kinds and null personal scope', () => {
    const sql = readFileSync(
      '../../prisma/migrations/20261002000000_scribe_doctor_templates/migration.sql',
      'utf8',
    );
    expect(sql).toContain(
      "('shortcut', 'note_style', 'template') AND \"clientId\" IS NULL AND \"sessionId\" IS NULL",
    );
    expect(sql).toContain("('teleconsult', 'coding', 'documents')");
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE|UPDATE "/);
  });
});
