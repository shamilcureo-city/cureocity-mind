import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScribeCodingResponseSchema, scribeCodingNoteIdentity } from './scribe-coding';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  session: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  differential: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.auth }));
vi.mock('./prisma', () => ({ prisma: { $transaction: h.transaction } }));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: h.encrypt, decryptForTenant: h.decrypt }));
vi.mock('./audit', () => ({ writeAudit: h.audit, auditMetadataFromRequest: () => ({}) }));
import { GET, PUT } from '../app/api/v1/scribe/encounters/[sessionId]/coding/route';

const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  chiefComplaint: 'Fictional concern',
});
const entry = {
  id: 'entry-a',
  origin: 'manual',
  code: 'R51.9',
  label: 'Fictional code label',
  system: 'ICD10_CM',
  release: 'fictional-test-release',
  decision: 'include',
  documentation: 'Doctor reviewed the fictional note.',
};
const worksheet = { version: 'V1', status: 'reviewed', entries: [entry] };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = `scribe-coding-${hash('session-a')}`;
let clientExists: boolean;
let ownerActive: boolean;
let session: { clientId: string; psychologistId: string; clientStatus: string; status: string };
let draft: { id: string; status: string; content: unknown } | null;
let signedNote: { signedAt: Date | null; content: unknown } | null;
let row: Record<string, unknown> | null;
let beforeWrite: (() => void) | null;
const tx = {
  $queryRaw: h.query,
  session: { findUnique: h.session },
  scribeWorkspaceRecord: {
    findFirst: h.findFirst,
    count: h.count,
    create: h.create,
    updateMany: h.updateMany,
    findUniqueOrThrow: h.findUniqueOrThrow,
  },
  differential: { findUnique: h.differential },
};
const ctx = { params: Promise.resolve({ sessionId: 'session-a' }) };
const url = 'https://scribe.example.test/api/v1/scribe/encounters/session-a/coding';
const get = () => GET(new NextRequest(url), ctx);
const put = (body: unknown) =>
  PUT(new NextRequest(url, { method: 'PUT', body: JSON.stringify(body) }), ctx);
async function input(overrides: Record<string, unknown> = {}) {
  const source = await (await get()).json();
  return {
    expectedRevision: row ? row.revision : 0,
    draftHash: source.draft.hash,
    workingNote: note,
    worksheet,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  clientExists = true;
  ownerActive = true;
  beforeWrite = null;
  row = null;
  signedNote = null;
  session = {
    clientId: 'client-a',
    psychologistId: 'doctor-a',
    clientStatus: 'ACTIVE',
    status: 'COMPLETED',
  };
  draft = { id: 'draft-a', status: 'COMPLETED', content: note };
  h.auth.mockResolvedValue({
    ok: true,
    value: {
      psychologistId: 'doctor-a',
      user: { vertical: 'DOCTOR', capabilities: ['MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS'] },
    },
  });
  h.query.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM "clients"'))
      return clientExists ? [{ id: 'client-a', psychologistId: 'doctor-a' }] : [];
    if (sql.includes('FROM "psychologists"')) return ownerActive ? [{ id: 'doctor-a' }] : [];
    if (sql.includes('FROM "sessions"')) return [session];
    if (sql.includes('FROM "note_drafts"')) return draft ? [draft] : [];
    if (sql.includes('FROM "therapy_notes"')) return signedNote ? [signedNote] : [];
    throw new Error('Unexpected SQL');
  });
  h.session.mockImplementation(async () => ({ ...session, therapyNote: signedNote }));
  h.transaction.mockImplementation(async (callback) => {
    if (beforeWrite && h.encrypt.mock.calls.length > 0) {
      beforeWrite();
      beforeWrite = null;
    }
    return callback(tx);
  });
  h.findFirst.mockImplementation(async ({ where }) =>
    row && row.id === where.id && row.psychologistId === where.psychologistId ? row : null,
  );
  h.count.mockResolvedValue(0);
  h.create.mockImplementation(async ({ data }) => {
    if (row) throw { code: 'P2002' };
    row = {
      ...data,
      revision: 1,
      createdAt: new Date('2026-09-26T00:00:00Z'),
      updatedAt: new Date('2026-09-26T00:00:00Z'),
    };
    return row;
  });
  h.updateMany.mockImplementation(async ({ where, data }) => {
    if (!row || row.revision !== where.revision) return { count: 0 };
    row = { ...row, bodyEncrypted: data.bodyEncrypted, revision: Number(row.revision) + 1 };
    return { count: 1 };
  });
  h.findUniqueOrThrow.mockImplementation(async () => row);
  h.differential.mockResolvedValue(null);
  h.encrypt.mockImplementation(async (_owner, text) => `fixture:${text}`);
  h.decrypt.mockImplementation(async (_owner, ciphertext) => ciphertext.slice('fixture:'.length));
});

describe('doctor coding worksheet route', () => {
  it('reads one locked snapshot without a saved worksheet, AI calls, or note writes', async () => {
    const response = await get();
    const body = ScribeCodingResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({
      draft: { id: 'draft-a', content: note },
      signed: false,
      signedNoteHash: null,
      record: null,
      sourceCurrent: null,
      suggestions: [],
    });
    expect(h.auth).toHaveBeenCalledWith(expect.anything(), 'MEDICAL_DOCUMENTATION');
    expect(h.transaction).toHaveBeenCalledOnce();
    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          psychologistId: 'doctor-a',
          clientId: 'client-a',
          sessionId: 'session-a',
          kind: 'coding',
        }),
      }),
    );
    expect(h.create).not.toHaveBeenCalled();
    expect(h.encrypt).not.toHaveBeenCalled();
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain('Fictional');
    const sql = h.query.mock.calls.map(([parts]) => parts.join('?'));
    expect(sql[0]).toContain('FROM "clients"');
    expect(sql[1]).toContain('FROM "psychologists"');
    expect(sql[2]).toContain('FOR UPDATE OF s');
    expect(sql[3]).toContain('FROM "note_drafts"');
  });
  it.each([401, 403])('denies missing login/capability (%i) before data access', async (status) => {
    h.auth.mockResolvedValue({ ok: false, response: Response.json({}, { status }) });
    expect((await get()).status).toBe(status);
    expect((await put({})).status).toBe(status);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it('rejects Mind users without touching their records', async () => {
    h.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor-a', user: { vertical: 'THERAPIST' } },
    });
    expect((await get()).status).toBe(403);
    expect((await put({})).status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it.each(['tenant', 'wrong_patient', 'inactive_patient', 'deleted_patient', 'inactive_owner'])(
    'rechecks lifecycle and scope under locks: %s',
    async (scenario) => {
      if (scenario === 'tenant') session.psychologistId = 'other';
      if (scenario === 'wrong_patient') session.clientId = 'other';
      if (scenario === 'inactive_patient') session.clientStatus = 'PAUSED';
      if (scenario === 'deleted_patient') clientExists = false;
      if (scenario === 'inactive_owner') ownerActive = false;
      expect((await get()).status).toBe(scenario === 'inactive_owner' ? 403 : 404);
      expect(h.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each(['session_pending', 'draft_pending', 'missing', 'invalid'])(
    'fails closed for an unavailable medical draft: %s',
    async (scenario) => {
      if (scenario === 'session_pending') session.status = 'IN_PROGRESS';
      if (scenario === 'draft_pending') draft!.status = 'PENDING';
      if (scenario === 'missing') draft = null;
      if (scenario === 'invalid') draft!.content = { version: 'bad' };
      expect((await get()).status).toBe(409);
    },
  );
  it('reads cached proposals as unverified pending choices, never auto-includes', async () => {
    h.differential.mockResolvedValue({
      status: 'COMPLETED',
      body: {
        version: 'V1',
        candidates: [{ condition: 'Fictional candidate', icd10Code: 'R51.9' }],
      },
    });
    const body = ScribeCodingResponseSchema.parse(await (await get()).json());
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({
      origin: 'ai_suggestion',
      decision: 'pending',
      system: null,
      release: '',
      documentation: '',
    });
    expect(h.create).not.toHaveBeenCalled();
  });
  it('keeps manual coding available without disclosing restricted clinical-analysis proposals', async () => {
    h.auth.mockResolvedValue({
      ok: true,
      value: {
        psychologistId: 'doctor-a',
        user: { vertical: 'DOCTOR', capabilities: ['MEDICAL_DOCUMENTATION'] },
      },
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).suggestions).toEqual([]);
    expect(h.differential).not.toHaveBeenCalled();
  });
  it('preserves unadopted cached proposals in the full save acknowledgement', async () => {
    h.differential.mockResolvedValue({
      status: 'COMPLETED',
      body: {
        version: 'V1',
        candidates: [{ condition: 'Fictional candidate', icd10Code: 'R51.9' }],
      },
    });
    const before = await (await get()).json();
    const response = await put(await input());
    expect(response.status).toBe(200);
    expect((await response.json()).suggestions).toEqual(before.suggestions);
  });
  it.each([
    null,
    { status: 'PENDING', body: null },
    { status: 'COMPLETED', body: { version: 'broken' } },
  ])('does not require a usable differential: %j', async (cached) => {
    h.differential.mockResolvedValue(cached);
    expect((await (await get()).json()).suggestions).toEqual([]);
  });
  it('saves encrypted reviewed choices with server-owned metadata without changing the note', async () => {
    const request = await input({ workingNote: { ...note, assessment: 'Doctor correction' } });
    const before = JSON.stringify(draft);
    const response = await put(request);
    const body = ScribeCodingResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(body.record).toMatchObject({
      id,
      revision: 1,
      clientId: 'client-a',
      sessionId: 'session-a',
      body: {
        worksheet,
        reviewedBy: 'doctor-a',
        reviewedNoteHash: hash(scribeCodingNoteIdentity(request.workingNote)),
      },
    });
    expect(body.record?.body.reviewedAt).toEqual(expect.any(String));
    expect(body.sourceCurrent).toBe(true);
    expect(JSON.stringify(draft)).toBe(before);
    expect(h.create.mock.calls[0]?.[0].data).not.toHaveProperty('body');
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(entry.documentation);
    expect(h.audit.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'SCRIBE_WORKSPACE_UPDATED' });
  });
  it('saving as draft clears all prior review metadata', async () => {
    expect((await put(await input())).status).toBe(200);
    const response = await put(await input({ worksheet: { ...worksheet, status: 'draft' } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.record.revision).toBe(2);
    expect(body.record.body).toMatchObject({
      reviewedBy: null,
      reviewedAt: null,
      reviewedNoteHash: null,
    });
  });
  it.each(['metadata', 'provenance', 'kind', 'pending_review'])(
    'rejects forged or incomplete review state: %s',
    async (scenario) => {
      const request = await input();
      if (scenario === 'metadata') Object.assign(request, { reviewedBy: 'someone-else' });
      if (scenario === 'provenance')
        request.workingNote = { ...note, linkedEvidence: [{ quote: 'forged' }] };
      if (scenario === 'kind') request.workingNote = { ...note, encounterKind: 'PROCEDURE' };
      if (scenario === 'pending_review')
        request.worksheet = { ...worksheet, entries: [{ ...entry, decision: 'pending' }] };
      expect((await put(request)).status).toBe(
        ['metadata', 'pending_review'].includes(scenario) ? 400 : 409,
      );
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it('rejects an outdated draft and rechecks again if it changes during encryption', async () => {
    const stale = await input();
    draft!.content = { ...note, hpi: 'New source' };
    expect((await put(stale)).status).toBe(409);
    const request = await input();
    beforeWrite = () => {
      draft!.content = { ...note, hpi: 'Another source' };
    };
    expect((await put(request)).status).toBe(409);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('serializes against signing and rejects delayed writes after erasure', async () => {
    const request = await input();
    beforeWrite = () => {
      signedNote = { signedAt: new Date(), content: note };
    };
    expect((await put(request)).status).toBe(409);
    signedNote = null;
    beforeWrite = () => {
      clientExists = false;
    };
    expect((await put(request)).status).toBe(404);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('rejects duplicate creates and stale edits without overwriting the winner', async () => {
    const request = await input();
    expect((await put(request)).status).toBe(200);
    const saved = JSON.stringify(row);
    expect((await put(request)).status).toBe(409);
    expect((await put({ ...request, expectedRevision: 7 })).status).toBe(409);
    expect(JSON.stringify(row)).toBe(saved);
  });
  it('freezes after signing and distinguishes an exact reviewed note from changed final content', async () => {
    const request = await input();
    await put(request);
    signedNote = { signedAt: new Date(), content: note };
    let response = ScribeCodingResponseSchema.parse(await (await get()).json());
    expect(response.signed).toBe(true);
    expect(response.sourceCurrent).toBe(true);
    expect(response.signedNoteHash).toBe(hash(scribeCodingNoteIdentity(note)));
    expect((await put({ ...request, expectedRevision: 1 })).status).toBe(409);
    signedNote.content = { ...note, assessment: 'Different signed assessment' };
    response = ScribeCodingResponseSchema.parse(await (await get()).json());
    expect(response.sourceCurrent).toBe(false);
    expect(response.record?.body.worksheet.status).toBe('reviewed');
  });
  it('never treats an undecryptable saved worksheet as an empty record', async () => {
    await put(await input());
    h.decrypt.mockResolvedValue(null);
    expect((await get()).status).toBe(503);
  });
  it('does not save if secure encryption is unavailable', async () => {
    const request = await input();
    h.encrypt.mockResolvedValue(null);
    expect((await put(request)).status).toBe(503);
    expect(h.create).not.toHaveBeenCalled();
  });
});

it('adds coding through a bounded additive migration without changing signature storage', () => {
  const sql = readFileSync(
    new URL(
      '../../../prisma/migrations/20260930000000_scribe_coding/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
  expect(sql).toContain("'teleconsult', 'coding'");
  expect(sql).toContain(
    'CREATE UNIQUE INDEX IF NOT EXISTS "scribe_workspace_one_coding_per_session"',
  );
  expect(sql).toContain('"sessionId" IS NOT NULL');
  expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM|TRUNCATE)\s+"/);
  expect(sql).not.toContain('therapy_notes');
});
