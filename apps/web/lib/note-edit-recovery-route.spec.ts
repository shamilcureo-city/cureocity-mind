import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteEditRecovery, Prisma } from '@prisma/client';
import { TherapyNoteV1Schema } from '@cureocity/contracts';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  session: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
  query: vi.fn(),
  upsert: vi.fn(),
  clear: vi.fn(),
  canonicalUpdate: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requireCapability: mocks.auth,
  requirePsychologistId: mocks.auth,
}));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./tenant-crypto', () => ({
  encryptForTenant: mocks.encrypt,
  decryptForTenant: mocks.decrypt,
}));
vi.mock('./mappers', () => ({ toNoteDraft: vi.fn() }));
vi.mock('./note-transcript', () => ({ resolveNoteTranscript: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: { $transaction: mocks.transaction, session: { findUnique: mocks.session } },
}));

import { GET, PUT, DELETE } from '../app/api/v1/sessions/[id]/note-edit-recovery/route';
import { PUT as saveCanonical } from '../app/api/v1/sessions/[id]/note-draft/route';

const BASE = '2026-09-07T10:00:00.000Z';
const NEXT = '2026-09-07T10:01:00.000Z';
const ID1 = 'eae9ed6e-fbee-4426-8123-898cc5255010';
const ID2 = 'c978ef76-66ed-42c2-a6f5-28320651a182';
const fields = { subjective: 'Synthetic unfinished note', objective: '', assessment: '', plan: '' };
const canonical = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'CBT',
  subjective: 'Original fictional account',
  objective: 'Observation',
  assessment: 'Review',
  plan: 'Follow up',
  riskFlags: { severity: 'none', indicators: [] },
});
let active: boolean;
let owner: string;
let row: NoteEditRecovery | null;
let session: {
  clientId: string;
  psychologistId: string;
  kind: 'TREATMENT' | 'INTAKE';
  status: string;
  psychologist: { vertical: string };
  noteDraft: { id: string; status: string; updatedAt: Date; content: object | null };
  therapyNote: { locked: boolean } | null;
};
const context = { params: Promise.resolve({ id: 'session-1' }) };
const request = (method: string, body?: unknown) =>
  new Request('https://example.test/api/v1/sessions/session-1/note-edit-recovery', {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }) as never;
const packet = (overrides: Record<string, unknown> = {}) => ({
  revision: 0,
  mutationId: ID1,
  baseUpdatedAt: BASE,
  kind: 'TREATMENT',
  fields,
  ...overrides,
});
const put = (overrides?: Record<string, unknown>) =>
  PUT(request('PUT', packet(overrides)), context);
const remove = (revision: number, mutationId = ID2) =>
  DELETE(request('DELETE', { revision, mutationId }), context);
const read = () => GET(request('GET'), context);
const save = (revision: number) =>
  saveCanonical(
    request('PUT', {
      note: { ...canonical, subjective: fields.subjective },
      expectedUpdatedAt: BASE,
      expectedRecoveryRevision: revision,
    }),
    context,
  );

beforeEach(() => {
  vi.resetAllMocks();
  active = true;
  owner = 'psy-1';
  row = null;
  session = {
    clientId: 'client-1',
    psychologistId: 'psy-1',
    kind: 'TREATMENT',
    status: 'COMPLETED',
    psychologist: { vertical: 'THERAPIST' },
    noteDraft: {
      id: 'draft-1',
      status: 'COMPLETED',
      updatedAt: new Date(BASE),
      content: canonical,
    },
    therapyNote: null,
  };
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  mocks.session.mockImplementation(async () => structuredClone(session));
  // An opaque envelope map: only ciphertext is persisted in the fake database.
  const envelopes = new Map<string, string>();
  mocks.encrypt.mockImplementation(async (_owner: string, plaintext: string) => {
    const encrypted = `opaque-envelope-${envelopes.size}`;
    envelopes.set(encrypted, plaintext);
    return encrypted;
  });
  mocks.decrypt.mockImplementation(
    async (_owner: string, ciphertext: string) => envelopes.get(ciphertext) ?? null,
  );
  mocks.upsert.mockImplementation(
    async ({ create, update }: { create: NoteEditRecovery; update: Partial<NoteEditRecovery> }) => {
      row = {
        ...(row ? { ...row, ...update } : create),
        createdAt: new Date(BASE),
        updatedAt: new Date(NEXT),
      };
      return structuredClone(row);
    },
  );
  mocks.canonicalUpdate.mockImplementation(async ({ data }: { data: { content: object } }) => {
    session.noteDraft.content = data.content;
    session.noteDraft.updatedAt = new Date(NEXT);
    return structuredClone(session.noteDraft);
  });
  mocks.clear.mockImplementation(async () => {
    if (!row) return { count: 0 };
    row = {
      ...row,
      encryptedFields: null,
      revision: row.revision + 1,
      baseDraftUpdatedAt: null,
      kind: null,
      lastMutationId: null,
      lastMutationOperation: null,
      lastMutationRevision: null,
    };
    return { count: 1 };
  });
  // Transactions run concurrently; only the actual PHI SELECT ... FOR UPDATE
  // acquires the mutex. Removing the production lock breaks the race tests.
  let lockTail = Promise.resolve();
  mocks.transaction.mockImplementation(
    async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      let snapshot: { row: NoteEditRecovery | null; session: typeof session } | undefined;
      const tx = {
        $queryRaw: async (strings: TemplateStringsArray) => {
          const sql = strings.join('?');
          mocks.query(sql);
          expect(sql).toContain('FOR UPDATE OF c');
          const predecessor = lockTail;
          lockTail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await predecessor;
          snapshot = structuredClone({ row, session });
          return active ? [{ id: 'client-1', psychologistId: owner }] : [];
        },
        session: { findUnique: mocks.session },
        noteEditRecovery: {
          findUnique: async () => structuredClone(row),
          upsert: mocks.upsert,
          updateMany: mocks.clear,
        },
        noteDraft: {
          findUnique: async () => structuredClone(session.noteDraft),
          update: mocks.canonicalUpdate,
        },
        therapyNote: { findUnique: async () => structuredClone(session.therapyNote) },
      };
      try {
        return await callback(tx as unknown as Prisma.TransactionClient);
      } catch (error) {
        if (snapshot) {
          row = snapshot.row;
          session = snapshot.session;
        }
        throw error;
      } finally {
        release?.();
      }
    },
  );
});

describe('encrypted note-edit recovery route adapters', () => {
  it('reads an absent checkpoint at revision zero and never caches it', async () => {
    const response = await read();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ revision: 0, recovery: null, stale: false });
  });
  it('round trips only encrypted clinical fields without touching the canonical note version or content', async () => {
    const response = await put();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revision: 1, updatedAt: NEXT });
    expect(mocks.encrypt).toHaveBeenCalledWith('psy-1', JSON.stringify(fields));
    expect(JSON.stringify(row)).not.toContain(fields.subjective);
    expect(session.noteDraft.updatedAt.toISOString()).toBe(BASE);
    expect(session.noteDraft.content).toEqual(canonical);
    expect(mocks.canonicalUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(fields.subjective);
    await expect((await read()).json()).resolves.toEqual({
      revision: 1,
      stale: false,
      recovery: { fields, kind: 'TREATMENT', baseUpdatedAt: BASE, updatedAt: NEXT },
    });
  });
  it.each(['GET', 'PUT', 'DELETE'])(
    'rejects missing authority before any %s database or crypto work',
    async (method) => {
      mocks.auth.mockResolvedValue({ ok: false, response: new Response('{}', { status: 403 }) });
      const response = await { GET: read, PUT: put, DELETE: () => remove(0) }[method as 'GET']();
      expect(response.status).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.encrypt).not.toHaveBeenCalled();
    },
  );
  it.each(['GET', 'PUT', 'DELETE'])(
    'returns a non-leaking 404 for erased or cross-tenant %s access',
    async (method) => {
      const action = { GET: read, PUT: put, DELETE: () => remove(0) }[method as 'GET'];
      for (const reason of ['erased', 'cross-tenant']) {
        active = reason !== 'erased';
        owner = reason === 'cross-tenant' ? 'psy-other' : 'psy-1';
        expect((await action()).status).toBe(404);
      }
      expect(mocks.encrypt).not.toHaveBeenCalled();
      expect(mocks.decrypt).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    },
  );
  it('rereads session ownership and stored vertical, not only the earlier client/auth snapshot', async () => {
    session.psychologistId = 'psy-other';
    expect((await put()).status).toBe(404);
    session.psychologistId = 'psy-1';
    session.psychologist.vertical = 'DOCTOR';
    expect((await put()).status).toBe(409);
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('rejects doctor context even if a behavioral-health capability was granted', async () => {
    mocks.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'psy-1', user: { vertical: 'DOCTOR' } },
    });
    expect((await put()).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('returns stale saved text for explicit review, and refuses an old-version autosave', async () => {
    await put();
    session.noteDraft.updatedAt = new Date(NEXT);
    expect((await read()).status).toBe(200);
    expect(await (await read()).json()).toMatchObject({ stale: true, recovery: { fields } });
    expect((await put({ revision: 1, mutationId: ID2 })).status).toBe(409);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
  it.each(['signed', 'generating', 'session-in-progress', 'missing-content', 'wrong-kind'])(
    'refuses a %s checkpoint',
    async (state) => {
      if (state === 'signed') session.therapyNote = { locked: true };
      if (state === 'generating') session.noteDraft.status = 'IN_PROGRESS';
      if (state === 'session-in-progress') session.status = 'IN_PROGRESS';
      if (state === 'missing-content') session.noteDraft.content = null;
      if (state === 'wrong-kind') session.kind = 'INTAKE';
      expect((await put()).status).toBe(409);
      expect(mocks.encrypt).not.toHaveBeenCalled();
    },
  );
  it('allows reopened signed notes but makes a subsequently locked checkpoint stale', async () => {
    session.therapyNote = { locked: false };
    expect((await put()).status).toBe(200);
    session.therapyNote.locked = true;
    expect(await (await read()).json()).toMatchObject({ stale: true });
  });
  it('acknowledges a lost PUT response exactly once and rejects mutation-id collisions', async () => {
    const first = await (await put()).json();
    expect(await (await put()).json()).toEqual(first);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect((await put({ fields: { ...fields, plan: 'Different synthetic text' } })).status).toBe(
      409,
    );
    expect((await put({ revision: 1 })).status).toBe(409);
    expect((await remove(1, ID1)).status).toBe(409);
  });
  it('serializes simultaneous same-revision writes; a losing tab cannot overwrite the winner', async () => {
    const responses = await Promise.all([
      put(),
      put({ mutationId: ID2, fields: { ...fields, plan: 'Other view' } }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(await (await read()).json()).toMatchObject({ revision: 1, recovery: { fields } });
  });
  it('retains a tombstone for repeated DELETE and prevents delayed stale resurrection', async () => {
    await put();
    const discarded = await remove(1);
    expect(await discarded.json()).toEqual({ revision: 2 });
    expect(await (await remove(1)).json()).toEqual({ revision: 2 });
    expect((await put()).status).toBe(409);
    expect((await put({ revision: 1, mutationId: crypto.randomUUID() })).status).toBe(409);
    expect((await put({ revision: 2, mutationId: ID2 })).status).toBe(409);
    expect(await (await read()).json()).toEqual({ revision: 2, recovery: null, stale: false });
  });
  it('creates a tombstone even if DELETE beats the first in-flight autosave', async () => {
    const results = await Promise.all([remove(0), put()]);
    expect(results.map((response) => response.status)).toEqual([200, 409]);
    expect(row?.encryptedFields).toBeNull();
  });
  it('preserves a newer checkpoint when an older discard arrives', async () => {
    await put();
    expect((await remove(0)).status).toBe(409);
    expect(row?.encryptedFields).not.toBeNull();
  });
  it('fails closed on encryption or decryption failure without saving/logging/returning plaintext', async () => {
    mocks.encrypt.mockRejectedValueOnce(new Error(fields.subjective));
    const failed = await put();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain(fields.subjective);
    expect(row).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
    await put();
    mocks.decrypt.mockResolvedValue(null);
    expect((await read()).status).toBe(503);
    expect((await put()).status).toBe(503);
    expect(row?.encryptedFields).not.toBeNull();
  });
  it('rolls back the checkpoint if its atomic audit fails', async () => {
    mocks.audit.mockRejectedValueOnce(new Error('Synthetic audit outage'));
    expect((await put()).status).toBe(503);
    expect(row).toBeNull();
  });
  it('clears only the acknowledged revision in the same canonical-save transaction', async () => {
    await put();
    expect((await save(0)).status).toBe(409);
    expect(mocks.clear).not.toHaveBeenCalled();
    expect((await save(1)).status).toBe(200);
    expect(row).toMatchObject({ revision: 2, encryptedFields: null, lastMutationId: null });
    expect((await put({ revision: 1, mutationId: ID2 })).status).toBe(409);
  });
  it('a checkpoint racing canonical save cannot be silently cleared from a different tab', async () => {
    await put();
    const results = await Promise.all([put({ revision: 1, mutationId: ID2 }), save(1)]);
    expect(results.map((response) => response.status)).toEqual([200, 409]);
    expect(row).toMatchObject({ revision: 2 });
    expect(row?.encryptedFields).not.toBeNull();
    expect(mocks.canonicalUpdate).not.toHaveBeenCalled();
  });
});
