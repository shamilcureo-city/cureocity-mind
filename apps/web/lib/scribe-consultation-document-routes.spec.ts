import { readFileSync } from 'node:fs';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ScribeConsultationDocumentsResponseSchema,
  ScribeConsultationDocumentUpdateSchema,
} from './scribe-consultation-documents';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  session: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.auth }));
vi.mock('./prisma', () => ({
  prisma: {
    $transaction: h.transaction,
    scribeWorkspaceRecord: { findFirst: h.findFirst, findMany: h.findMany },
  },
}));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: h.encrypt, decryptForTenant: h.decrypt }));
vi.mock('./audit', () => ({ writeAudit: h.audit, auditMetadataFromRequest: () => ({}) }));
import { GET, POST } from '../app/api/v1/scribe/encounters/[sessionId]/documents/route';
import { PATCH } from '../app/api/v1/scribe/documents/[id]/route';
import { GET as download } from '../app/api/v1/scribe/documents/[id]/[documentId]/text/route';

const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  chiefComplaint: 'Fictional concern',
  hpi: 'Fictional history',
  assessment: 'Fictional signed assessment',
  plan: 'Fictional signed plan',
});
type Row = {
  id: string;
  revision: number;
  psychologistId: string;
  clientId: string;
  sessionId: string;
  kind: string;
  bodyEncrypted: string;
  createdAt: Date;
  updatedAt: Date;
};
let rows: Row[];
let clientActive: boolean;
let ownerActive: boolean;
let session: { clientId: string; psychologistId: string; status: string; clientStatus: string };
let signed: {
  id: string;
  version: string;
  content: unknown;
  rxPad: unknown;
  signedAt: Date | null;
  signedBy: string;
  locked: boolean;
} | null;
let delayedChange: (() => void) | null;
const tx = {
  $queryRaw: h.query,
  session: { findUnique: h.session },
  scribeWorkspaceRecord: {
    findFirst: h.findFirst,
    findMany: h.findMany,
    count: h.count,
    create: h.create,
    updateMany: h.updateMany,
    findUniqueOrThrow: h.findUniqueOrThrow,
  },
};
const operationId = '11ca13f2-4563-4d97-a5f8-39b898fa0001';
const url = 'https://scribe.example.test/api/v1/scribe/encounters/session-a/documents';
const ctx = { params: Promise.resolve({ sessionId: 'session-a' }) };
const get = () => GET(new NextRequest(url), ctx);
const post = (body: unknown) =>
  POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }), ctx);
const patch = (body: unknown, id = rows[0]?.id ?? 'missing') =>
  PATCH(new NextRequest(`${url}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const text = (documentId = 'referral', revision: number | null = rows[0]?.revision ?? 1) =>
  download(
    new NextRequest(
      `https://scribe.example.test/api/v1/scribe/documents/${rows[0]?.id}/${documentId}/text${revision === null ? '' : `?revision=${revision}`}`,
    ),
    { params: Promise.resolve({ id: rows[0]?.id ?? 'missing', documentId }) },
  );
async function createInput(overrides: Record<string, unknown> = {}) {
  const { source } = await (await get()).json();
  return {
    operationId,
    expectedSourceHash: source.hash,
    types: ['referral', 'patient_summary', 'medical_certificate'],
    ...overrides,
  };
}
const match = (row: Row, where: Record<string, unknown>) =>
  ['id', 'psychologistId', 'clientId', 'sessionId', 'kind', 'revision'].every(
    (key) => where[key] === undefined || row[key as keyof Row] === where[key],
  );

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  clientActive = true;
  ownerActive = true;
  delayedChange = null;
  session = {
    clientId: 'client-a',
    psychologistId: 'doctor-a',
    status: 'COMPLETED',
    clientStatus: 'ACTIVE',
  };
  signed = {
    id: 'note-a',
    version: 'V1',
    content: note,
    rxPad: null,
    signedAt: new Date('2026-09-26T12:00:00Z'),
    signedBy: 'doctor-a',
    locked: true,
  };
  h.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-a', user: { vertical: 'DOCTOR' } },
  });
  h.query.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM "clients"'))
      return clientActive ? [{ id: 'client-a', psychologistId: 'doctor-a' }] : [];
    if (sql.includes('FROM "psychologists"')) return ownerActive ? [{ id: 'doctor-a' }] : [];
    if (sql.includes('FROM "sessions"')) return [session];
    if (sql.includes('FROM "therapy_notes"')) return signed ? [signed] : [];
    throw new Error('Unexpected SQL');
  });
  h.session.mockImplementation(async () => ({ ...session, therapyNote: signed }));
  h.transaction.mockImplementation(async (callback) => callback(tx));
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
  h.findUniqueOrThrow.mockImplementation(async ({ where }) =>
    rows.find((row) => row.id === where.id),
  );
  h.encrypt.mockImplementation(async (_owner, plaintext) => {
    if (delayedChange) {
      delayedChange();
      delayedChange = null;
    }
    return `fixture:${plaintext}`;
  });
  h.decrypt.mockImplementation(async (_owner, ciphertext) => ciphertext.slice('fixture:'.length));
});

describe('one signed consultation, multiple reviewed document drafts', () => {
  it('returns a locked source with null Rx supported and a private empty history', async () => {
    const response = await get();
    const body = ScribeConsultationDocumentsResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.source).toMatchObject({
      state: 'ready',
      noteId: 'note-a',
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(body.packets).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.query.mock.calls[0]?.[0].join('?')).toContain('FROM "clients"');
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain('Fictional');
  });
  it.each([401, 403])('fails login/capability %i before disclosing records', async (status) => {
    h.auth.mockResolvedValue({ ok: false, response: Response.json({}, { status }) });
    expect((await get()).status).toBe(status);
    expect((await post({})).status).toBe(status);
    expect((await patch({})).status).toBe(status);
    expect((await text()).status).toBe(status);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.findFirst).not.toHaveBeenCalled();
  });
  it('keeps the new workflow doctor-only', async () => {
    h.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor-a', user: { vertical: 'THERAPIST' } },
    });
    expect((await get()).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it.each(['tenant', 'patient', 'inactive', 'erased', 'owner'])(
    'rejects unavailable lifecycle/ownership: %s',
    async (scenario) => {
      if (scenario === 'tenant') session.psychologistId = 'other';
      if (scenario === 'patient') session.clientId = 'other';
      if (scenario === 'inactive') session.clientStatus = 'PAUSED';
      if (scenario === 'erased') clientActive = false;
      if (scenario === 'owner') ownerActive = false;
      expect((await get()).status).toBe(scenario === 'owner' ? 403 : 404);
      expect(h.findMany).not.toHaveBeenCalled();
    },
  );
  it('creates all three drafts in one encrypted record from the exact same signed source', async () => {
    const input = await createInput();
    const before = JSON.stringify(signed);
    const response = await post(input);
    const body = ScribeConsultationDocumentsResponseSchema.parse(await response.json());
    expect(response.status).toBe(201);
    expect(h.create).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
    const packet = body.packets[0]!;
    expect(packet.body).toMatchObject({
      operationId,
      sourceHash: input.expectedSourceHash,
      noteId: 'note-a',
      signedAt: signed!.signedAt!.toISOString(),
    });
    expect(packet.body.documents.map((document) => document.type)).toEqual(input.types);
    for (const document of packet.body.documents)
      expect(document).toMatchObject({
        additions: '',
        status: 'draft',
        reviewedAt: null,
        reviewedBy: null,
      });
    expect(
      packet.body.documents.find((document) => document.type === 'medical_certificate')!
        .sourceSections,
    ).toEqual([]);
    expect(packet.body.documents[0]!.sourceSections[0]).toEqual({
      label: 'Signed chief complaint',
      text: note.chiefComplaint,
    });
    expect(JSON.stringify(signed)).toBe(before);
    expect(h.create.mock.calls[0]?.[0].data).not.toHaveProperty('body');
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain('Fictional');
  });
  it('includes only confirmed prescription rows without inferring schedule or dose', async () => {
    signed!.rxPad = {
      version: 'V1',
      meds: [
        { drug: 'Fictional A', frequency: '1-0-1', status: 'confirmed' },
        { drug: 'Unconfirmed B', status: 'pending' },
      ],
      adviceLines: [],
    };
    const response = await post(await createInput());
    const body = await response.json();
    const summary = body.packets[0].body.documents.find(
      (document: { type: string }) => document.type === 'patient_summary',
    );
    expect(JSON.stringify(summary)).toContain('Fictional A · Schedule: 1-0-1');
    expect(JSON.stringify(summary)).not.toContain('Unconfirmed B');
    expect(JSON.stringify(summary)).not.toContain('Dose:');
  });
  it('recovers the same operation without duplicating or resetting already reviewed content', async () => {
    const input = await createInput();
    await post(input);
    await patch({
      revision: 1,
      documentId: 'referral',
      additions: 'Doctor-entered destination and reason.',
      reviewed: true,
    });
    const response = await post(input);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(h.create).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
    expect(body.packets[0].revision).toBe(2);
    expect(body.packets[0].body.documents[0]).toMatchObject({
      additions: 'Doctor-entered destination and reason.',
      status: 'reviewed',
    });
    expect((await post({ ...input, types: ['referral'] })).status).toBe(409);
    expect((await post({ ...input, expectedSourceHash: 'a'.repeat(64) })).status).toBe(409);
  });
  it('canonicalizes type order for safe same-operation retries', async () => {
    const input = await createInput();
    await post(input);
    expect((await post({ ...input, types: [...input.types].reverse() })).status).toBe(200);
    expect(rows).toHaveLength(1);
  });
  it('recovers a concurrent identical create after its unique-key race', async () => {
    const input = await createInput();
    const responses = await Promise.all([post(input), post(input)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(rows).toHaveLength(1);
  });
  it.each(['hash', 'unlock', 'erasure'])(
    'persists nothing if source authority changes before write: %s',
    async (scenario) => {
      const input = await createInput();
      delayedChange = () => {
        if (scenario === 'hash') signed!.content = { ...note, plan: 'Changed signed source' };
        if (scenario === 'unlock') signed!.locked = false;
        if (scenario === 'erasure') clientActive = false;
      };
      expect((await post(input)).status).toBe(scenario === 'erasure' ? 404 : 409);
      expect(rows).toEqual([]);
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it('preserves historical packets but marks all stale after unlock, invalid source, or re-sign', async () => {
    const input = await createInput();
    await post(input);
    signed!.locked = false;
    let body = await (await get()).json();
    expect(body.source.state).toBe('unsigned');
    expect(body.packets[0].sourceCurrent).toBe(false);
    expect(
      (await patch({ revision: 1, documentId: 'referral', additions: '', reviewed: true })).status,
    ).toBe(409);
    signed!.locked = true;
    signed!.content = { version: 'invalid' };
    body = await (await get()).json();
    expect(body.source.state).toBe('unavailable');
    expect(body.packets).toHaveLength(1);
    expect(body.packets[0].sourceCurrent).toBe(false);
    signed!.content = note;
    signed!.signedAt = new Date('2026-09-26T13:00:00Z');
    body = await (await get()).json();
    expect(body.source.state).toBe('ready');
    expect(body.packets[0].sourceCurrent).toBe(false);
    expect((await post(input)).status).toBe(200); // recovery, never a rebase
    expect(rows).toHaveLength(1);
  });
  it.each(['content', 'rx', 'version', 'date', 'id', 'signer'])(
    'binds freshness to the signed source dimension %s',
    async (field) => {
      const oldHash = (await (await get()).json()).source.hash;
      if (field === 'content') signed!.content = { ...note, assessment: 'Changed' };
      if (field === 'rx') signed!.rxPad = { version: 'V1', meds: [], adviceLines: ['Changed'] };
      if (field === 'version') signed!.version = 'V2';
      if (field === 'date') signed!.signedAt = new Date('2026-09-26T13:00:00Z');
      if (field === 'id') signed!.id = 'note-b';
      if (field === 'signer') signed!.signedBy = 'other';
      expect((await (await get()).json()).source.hash).not.toBe(oldHash);
    },
  );
  it('never confirms or exports an unsigned or invalid signed note', async () => {
    const input = await createInput();
    signed = null;
    expect((await (await get()).json()).source.state).toBe('unsigned');
    expect((await post(input)).status).toBe(409);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('allows only explicit exact-text review and preserves immutable sections and siblings', async () => {
    await post(await createInput());
    const original = await (await get()).json();
    let response = await patch({
      revision: 1,
      documentId: 'referral',
      additions: 'Doctor authored referral purpose.',
      reviewed: true,
    });
    let packet = (await response.json()).packets[0];
    expect(response.status).toBe(200);
    expect(packet.revision).toBe(2);
    expect(packet.body.documents[0]).toMatchObject({
      status: 'reviewed',
      reviewedBy: 'doctor-a',
      reviewedAt: expect.any(String),
    });
    expect(packet.body.documents[0].sourceSections).toEqual(
      original.packets[0].body.documents[0].sourceSections,
    );
    expect(packet.body.documents[1]).toEqual(original.packets[0].body.documents[1]);
    response = await patch({
      revision: 2,
      documentId: 'referral',
      additions: 'Changed doctor addition',
      reviewed: false,
    });
    packet = (await response.json()).packets[0];
    expect(packet.body.documents[0]).toMatchObject({
      status: 'draft',
      reviewedAt: null,
      reviewedBy: null,
    });
    expect(
      (
        await patch({
          revision: 1,
          documentId: 'referral',
          additions: 'Stale overwrite',
          reviewed: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await patch({
          revision: 3,
          documentId: 'referral',
          additions: '',
          reviewed: true,
          sourceSections: [],
        })
      ).status,
    ).toBe(400);
  });
  it('rejects a guessed future revision before it can overwrite concurrently updated sibling documents', async () => {
    await post(await createInput());
    h.encrypt.mockClear();
    delayedChange = () => {
      rows[0]!.revision = 2;
    };
    expect(
      (
        await patch({
          revision: 2,
          documentId: 'referral',
          additions: 'Unseen replacement',
          reviewed: true,
        })
      ).status,
    ).toBe(409);
    expect(h.encrypt).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(rows[0]!.revision).toBe(1);
  });
  it('copies signed Rx advice, investigations and follow-up without adding instructions', async () => {
    signed!.rxPad = {
      version: 'V1',
      meds: [],
      adviceLines: ['Verbatim advice'],
      investigations: [{ name: 'Verbatim test' }],
      followUp: { when: 'Verbatim time', withWhat: 'Verbatim item' },
    };
    const response = await post(await createInput());
    const body = await response.json();
    const summary = body.packets[0].body.documents.find(
      (document: { type: string }) => document.type === 'patient_summary',
    );
    expect(summary.sourceSections).toEqual(
      expect.arrayContaining([
        { label: 'Signed prescription advice', text: 'Verbatim advice' },
        { label: 'Signed prescription investigations', text: 'Verbatim test' },
        { label: 'Signed prescription follow-up', text: 'Verbatim time — Verbatim item' },
      ]),
    );
  });
  it('requires document review, exact packet revision, current source and separate sharing authority to download', async () => {
    await post(await createInput());
    expect((await text()).status).toBe(409);
    expect((await text('referral', null)).status).toBe(400);
    await patch({
      revision: 1,
      documentId: 'referral',
      additions: 'Doctor-only addition',
      reviewed: true,
    });
    expect((await text('referral', 1)).status).toBe(409);
    const response = await text();
    const output = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(output).toContain('DRAFT ONLY');
    expect(output).toContain('NOT COVERED BY THE SOURCE NOTE SIGNATURE');
    expect(output).toContain('Doctor-only addition');
    h.auth.mockImplementation(async (_req, cap) =>
      cap === 'PATIENT_SHARING'
        ? { ok: false, response: Response.json({}, { status: 403 }) }
        : { ok: true, value: { psychologistId: 'doctor-a', user: { vertical: 'DOCTOR' } } },
    );
    expect((await text()).status).toBe(403);
    h.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor-a', user: { vertical: 'DOCTOR' } },
    });
    signed!.locked = false;
    expect((await text()).status).toBe(409);
  });
  it('allows saving unfinished template prompts but rejects marking them reviewed', async () => {
    await post(await createInput());
    const additions = 'Recipient\n[[Complete: Recipient]]';
    expect(
      (await patch({ revision: 1, documentId: 'referral', additions, reviewed: false })).status,
    ).toBe(200);
    expect(
      (await patch({ revision: 2, documentId: 'referral', additions, reviewed: true })).status,
    ).toBe(409);
    expect(rows[0]!.revision).toBe(2);
    expect(
      (
        await patch({
          revision: 2,
          documentId: 'referral',
          additions: 'Recipient clarified by doctor',
          reviewed: true,
        })
      ).status,
    ).toBe(200);
  });
  it('rejects legacy reviewed documents with unfinished prompts at download time', async () => {
    await post(await createInput());
    await patch({ revision: 1, documentId: 'referral', additions: '', reviewed: true });
    const body = JSON.parse(rows[0]!.bodyEncrypted.slice('fixture:'.length));
    body.documents[0].additions = '[ [ cOmPlEtE: unfinished';
    rows[0]!.bodyEncrypted = `fixture:${JSON.stringify(body)}`;
    h.audit.mockClear();
    expect((await text()).status).toBe(409);
    expect(h.audit).not.toHaveBeenCalled();
  });
  it('marks a reviewed certificate draft NOT VALID FOR ISSUE without inventing particulars', async () => {
    await post(await createInput());
    await patch({ revision: 1, documentId: 'medical_certificate', additions: '', reviewed: true });
    const response = await text('medical_certificate');
    const output = await response.text();
    expect(response.status).toBe(200);
    expect(output).toContain('NOT VALID FOR ISSUE');
    expect(output).toContain(
      'No medical fitness, incapacity, examination or leave statement has been inferred.',
    );
    expect(output).toContain('(No additions entered.)');
  });
  it('rechecks deletion/replacement between preliminary lookup and locked download', async () => {
    await post(await createInput());
    await patch({ revision: 1, documentId: 'referral', additions: '', reviewed: true });
    h.transaction.mockImplementationOnce(async (callback) => {
      rows[0]!.revision += 1;
      return callback(tx);
    });
    expect((await text('referral', 2)).status).toBe(409);
  });
  it('fails visibly on unavailable encryption or unreadable history instead of silently dropping drafts', async () => {
    const input = await createInput();
    h.encrypt.mockResolvedValueOnce(null);
    expect((await post(input)).status).toBe(503);
    expect(rows).toEqual([]);
    await post(input);
    h.decrypt.mockResolvedValue(null);
    expect((await get()).status).toBe(503);
  });
  it('bounds create/review requests and rejects malformed document types', async () => {
    const input = await createInput();
    expect((await post({ ...input, types: ['referral', 'referral'] })).status).toBe(400);
    expect((await post({ ...input, types: ['issued_certificate'] })).status).toBe(400);
    expect(
      ScribeConsultationDocumentUpdateSchema.safeParse({
        revision: 1,
        documentId: 'referral',
        additions: 'x'.repeat(12_001),
        reviewed: true,
      }).success,
    ).toBe(false);
  });
  it('rejects oversized signed source excerpts without silently truncating them', async () => {
    signed!.content = { ...note, hpi: 'x'.repeat(24_001) };
    expect((await post(await createInput())).status).toBe(409);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('bounds the total UTF-8 packet even when each source section fits its character limit', async () => {
    signed!.content = {
      ...note,
      chiefComplaint: 'अ'.repeat(24_000),
      hpi: 'अ'.repeat(24_000),
      assessment: 'अ'.repeat(24_000),
      plan: 'अ'.repeat(24_000),
    };
    expect((await post(await createInput())).status).toBe(413);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('preserves all ten packets and rejects an eleventh rather than omitting old history', async () => {
    const input = await createInput();
    for (let index = 0; index < 10; index++)
      expect(
        (
          await post({
            ...input,
            operationId: `11ca13f2-4563-4d97-a5f8-${String(index).padStart(12, '0')}`,
          })
        ).status,
      ).toBe(201);
    expect((await (await get()).json()).packets).toHaveLength(10);
    expect(
      (await post({ ...input, operationId: '11ca13f2-4563-4d97-a5f8-999999999999' })).status,
    ).toBe(409);
    expect(rows).toHaveLength(10);
  });
});

it('uses a bounded additive storage migration, with no signature/schema rewrite or AI dependency', () => {
  const migration = readFileSync(
    new URL(
      '../../../prisma/migrations/20261001000000_scribe_consultation_documents/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  expect(migration).toContain("SET LOCAL lock_timeout = '5s'");
  expect(migration).toContain("'documents'");
  expect(migration).not.toContain('therapy_notes');
  expect(migration).not.toMatch(/\b(?:UPDATE|DELETE FROM|TRUNCATE)\s+"/);
  const source = readFileSync(
    new URL('./scribe-consultation-document-source.ts', import.meta.url),
    'utf8',
  );
  expect(source).not.toMatch(/generateDocumentJson|fetch\(|runDifferential|runNote/);
});
