import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgreementRevision } from '@cureocity/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  note: vi.fn(),
  exportRows: vi.fn(),
  session: vi.fn(),
  create: vi.fn(),
  count: vi.fn(),
  homework: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./prisma', () => ({
  prisma: { $transaction: mocks.transaction, session: { findFirst: mocks.session } },
}));
import { PATCH, DELETE } from '../app/api/v1/sessions/[id]/agreements/[agreementId]/route';
import { loadClientAgreementExport } from './session-agreement-export';
import { POST } from '../app/api/v1/sessions/[id]/agreements/route';

type Row = {
  id: string;
  sessionId: string;
  clientId: string;
  psychologistId: string;
  text: string;
  speaker: 'CLIENT' | 'THERAPIST';
  followUp: 'DONE' | null;
  createdAt: Date;
  revision: number;
  revisions: AgreementRevision[] | null;
  creationOperationId?: string;
  followUpAt?: Date | null;
  retiredAt?: Date | null;
  retirementReason?: string | null;
};
const base: Row = {
  id: 'agreement-1',
  sessionId: 'session-1',
  clientId: 'client-1',
  psychologistId: 'psy-1',
  text: 'Original fictional agreement',
  speaker: 'THERAPIST',
  followUp: null,
  createdAt: new Date('2026-09-09T09:00:00Z'),
  revision: 0,
  revisions: null,
};
let row: Row;
const input = {
  operation: 'correct',
  operationId: 'daf32f03-d826-47e8-9152-07ef7ff265c5',
  expectedRevision: 0,
  text: 'Corrected fictional agreement',
  speaker: 'CLIENT',
  reason: 'CORRECTION',
};
const params = { params: Promise.resolve({ id: 'session-1', agreementId: 'agreement-1' }) };
const req = (method: 'PATCH' | 'DELETE', body: unknown) =>
  new Request('https://example.test/api/v1/sessions/session-1/agreements/agreement-1', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
const patch = (body: unknown = input) => PATCH(req('PATCH', body), params);
const remove = (body: unknown = { expectedRevision: 0 }) => DELETE(req('DELETE', body), params);

beforeEach(() => {
  vi.resetAllMocks();
  row = structuredClone(base);
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  mocks.lock.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  mocks.find.mockImplementation(async ({ where }) =>
    Object.entries(where).every(([key, value]) => row[key as keyof Row] === value) ? row : null,
  );
  mocks.note.mockResolvedValue(null);
  mocks.session.mockResolvedValue({ id: 'session-1', clientId: 'client-1' });
  mocks.create.mockImplementation(async ({ data }) => (row = { ...base, ...data }));
  mocks.count.mockResolvedValue(0);
  mocks.homework.mockResolvedValue(null);
  mocks.update.mockImplementation(async ({ data }) => (row = { ...row, ...data }));
  mocks.exportRows.mockImplementation(async () => [row]);
  // Model the shared database row lock: each writer sees prior committed history.
  let tail = Promise.resolve();
  mocks.transaction.mockImplementation(async (callback) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      return await callback({
        $queryRaw: async () => {
          await previous;
          return mocks.lock();
        },
        sessionAgreement: {
          findFirst: mocks.find,
          update: mocks.update,
          delete: mocks.remove,
          findMany: mocks.exportRows,
          create: mocks.create,
          count: mocks.count,
        },
        therapyNote: { findUnique: mocks.note },
        exerciseAssignment: { findFirst: mocks.homework },
      });
    } finally {
      release();
    }
  });
});

describe('canonical agreement corrections and signed-session amendments', () => {
  it('retires unfinished work explicitly without marking done or changing the saved wording', async () => {
    const response = await patch({
      operation: 'retire',
      expectedRevision: 0,
      reason: 'Client and clinician agreed this is no longer useful',
    });
    expect(response.status).toBe(200);
    expect(row.retiredAt).toBeInstanceOf(Date);
    expect(row.text).toBe(base.text);
    expect(row.followUp).toBeNull();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ op: 'retire', revision: 0 }) }),
      expect.anything(),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('Client and clinician agreed');
    expect((await patch({ followUp: 'DONE', expectedRevision: 0 })).status).toBe(409);
  });
  it('retries retirement once and rejects a conflicting reason or stale wording', async () => {
    const retirement = {
      operation: 'retire',
      expectedRevision: 0,
      reason: 'Agreed to stop carrying this',
    };
    expect((await patch(retirement)).status).toBe(200);
    expect((await patch(retirement)).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect((await patch({ ...retirement, reason: 'Different reason' })).status).toBe(409);
    expect((await patch({ ...retirement, expectedRevision: 1 })).status).toBe(409);
  });
  it('keeps retirement in correction history while reopening the corrected wording for review', async () => {
    row.retiredAt = new Date('2026-09-10T10:00:00Z');
    row.retirementReason = 'No longer relevant';
    expect((await patch()).status).toBe(200);
    expect(row.retiredAt).toBeNull();
    expect(row.retirementReason).toBeNull();
    expect(row.revisions?.[0]).toMatchObject({
      previousRetiredAt: '2026-09-10T10:00:00.000Z',
      previousRetirementReason: 'No longer relevant',
    });
  });
  it('cannot delete an agreement that is provenance for separate homework', async () => {
    mocks.homework.mockResolvedValue({ id: 'homework-1' });
    expect((await remove()).status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('preserves the original wording and attribution, updates one canonical row, audits hashes only', async () => {
    const response = await patch();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.agreement).toMatchObject({ text: input.text, speaker: 'CLIENT', revision: 1 });
    expect(row.revisions).toHaveLength(1);
    expect(row.revisions![0]).toMatchObject({
      previousText: base.text,
      previousSpeaker: 'THERAPIST',
      text: input.text,
      recordedBy: 'psy-1',
      signedNoteId: null,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AGREEMENT_RECORDED',
        metadata: expect.objectContaining({
          op: 'correct',
          revision: 1,
          beforeHash: expect.any(String),
          afterHash: expect.any(String),
        }),
      }),
      expect.anything(),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(base.text);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(input.text);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.find.mock.invocationCallOrder[0]!,
    );
  });
  it('replays a lost response without appending or auditing a second revision', async () => {
    expect((await patch()).status).toBe(200);
    expect((await patch()).status).toBe(200);
    expect(row.revision).toBe(1);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it('rejects operation-id reuse with different wording', async () => {
    await patch();
    expect((await patch({ ...input, text: 'Different text' })).status).toBe(409);
    expect(row.revision).toBe(1);
  });
  it('keeps the creation receipt stable after a lost POST response followed by a correction', async () => {
    const creation = {
      text: base.text,
      speaker: base.speaker,
      operationId: '289e2f34-2d12-4be3-bb2a-cfce28fc20d2',
    };
    const post = (body = creation) =>
      POST(
        new Request('https://example.test/api/v1/sessions/session-1/agreements', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }) as never,
        { params: Promise.resolve({ id: 'session-1' }) },
      );
    expect((await post()).status).toBe(201);
    expect((await patch()).status).toBe(200);
    const retry = await post();
    expect(retry.status).toBe(200);
    expect((await retry.json()).agreement).toMatchObject({
      id: base.id,
      text: input.text,
      revision: 1,
    });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect((await post({ ...creation, text: 'Different creation intent' })).status).toBe(409);
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it('does not apply an old completion mark to corrected wording, preserving it in history', async () => {
    row.followUp = 'DONE';
    row.followUpAt = new Date('2026-09-09T10:00:00Z');
    mocks.note.mockResolvedValue({ id: 'signed-note' });
    expect((await patch({ ...input, operation: 'amend' })).status).toBe(200);
    expect(row.followUp).toBeNull();
    expect(row.followUpAt).toBeNull();
    expect(row.revisions![0]).toMatchObject({
      previousFollowUp: 'DONE',
      previousFollowUpAt: '2026-09-09T10:00:00.000Z',
    });
    expect((await patch({ followUp: 'DONE', expectedRevision: 0 })).status).toBe(409);
    expect((await patch({ followUp: 'DONE' })).status).toBe(409);
    expect(row.followUp).toBeNull();
    expect((await patch({ followUp: 'DONE', expectedRevision: 1 })).status).toBe(200);
    expect(row.followUp).toBe('DONE');
  });
  it('serializes correction and stale follow-up so the new wording is never silently done', async () => {
    const responses = await Promise.all([
      patch(),
      patch({ followUp: 'DONE', expectedRevision: 0 }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 409]);
    expect(row.followUp).toBeNull();
    expect(row.revision).toBe(1);
  });
  it('permits one of two concurrent stale edits, without losing prior content', async () => {
    const responses = await Promise.all([
      patch(),
      patch({
        ...input,
        operationId: '289e2f34-2d12-4be3-bb2a-cfce28fc20d2',
        text: 'Other correction',
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(row.revision).toBe(1);
    expect(row.revisions![0]!.previousText).toBe(base.text);
  });
  it('requires explicit amendment after signing, including an unlocked signed note', async () => {
    mocks.note.mockResolvedValue({ id: 'signed-note', locked: false });
    expect((await patch()).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await patch({ ...input, operation: 'amend' })).status).toBe(200);
    expect(row.revisions![0]).toMatchObject({
      operation: 'amend',
      signedNoteId: 'signed-note',
      previousText: base.text,
    });
    // The transaction exposes only note reads: no signed-note mutation is possible here.
    expect(mocks.note).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
      select: { id: true },
    });
  });
  it('retains every correction and exports full history rather than only hashes', async () => {
    await patch();
    mocks.note.mockResolvedValue({ id: 'signed-note' });
    await patch({
      ...input,
      operation: 'amend',
      operationId: '289e2f34-2d12-4be3-bb2a-cfce28fc20d2',
      expectedRevision: 1,
      text: 'Clarified after signing',
      reason: 'CLARIFICATION',
    });
    const exported = await mocks.transaction((tx: never) =>
      loadClientAgreementExport(tx, 'client-1', 'psy-1'),
    );
    expect(exported[0].revisions).toHaveLength(2);
    expect(exported[0].revisions[0].previousText).toBe(base.text);
    expect(exported[0].revisions[1].previousText).toBe(input.text);
    expect(exported[0].text).toBe('Clarified after signing');
    expect(mocks.exportRows).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'client-1', psychologistId: 'psy-1' } }),
    );
  });
  it('denies another owner and erasure winning the client lock, including export', async () => {
    mocks.lock.mockResolvedValue([{ id: 'client-1', psychologistId: 'other-owner' }]);
    expect((await patch()).status).toBe(404);
    expect((await remove()).status).toBe(404);
    expect(mocks.find).not.toHaveBeenCalled();
    mocks.lock.mockResolvedValue([]);
    expect((await patch()).status).toBe(404);
    await expect(
      mocks.transaction((tx: never) => loadClientAgreementExport(tx, 'client-1', 'psy-1')),
    ).rejects.toThrow('erased');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.exportRows).not.toHaveBeenCalled();
  });
  it('rejects cross-session ids and malformed correction payloads before writes', async () => {
    row.sessionId = 'other-session';
    expect((await patch()).status).toBe(404);
    for (const body of [
      { ...input, text: ' ' },
      { ...input, expectedRevision: -1 },
      { ...input, operationId: 'bad' },
      { ...input, followUp: 'DONE' },
    ]) {
      expect((await patch(body)).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('fails closed on corrupt or incomplete history instead of overwriting it', async () => {
    row.revision = 1;
    row.revisions = [];
    expect((await patch({ ...input, expectedRevision: 1 })).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('never deletes signed agreements or rows with later follow-up; permits audited pre-sign removal', async () => {
    mocks.note.mockResolvedValue({ id: 'signed-note' });
    expect((await remove()).status).toBe(409);
    mocks.note.mockResolvedValue(null);
    row.followUp = 'DONE';
    expect((await remove()).status).toBe(409);
    row.followUp = null;
    expect((await remove({ expectedRevision: 1 })).status).toBe(409);
    expect((await remove()).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ op: 'delete' }) }),
      expect.anything(),
    );
  });
  it('keeps follow-up marking separate and retry safe after signing', async () => {
    mocks.note.mockResolvedValue({ id: 'signed-note' });
    expect((await patch({ followUp: 'DONE' })).status).toBe(200);
    expect((await patch({ followUp: 'DONE' })).status).toBe(200);
    expect(row.revision).toBe(0);
    expect(row.revisions).toBeNull();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it('keeps history on the same erased clinical row and includes it in the DSR export', () => {
    const schema = readFileSync(resolve(process.cwd(), '../../prisma/schema.prisma'), 'utf8');
    const model = schema.slice(
      schema.indexOf('model SessionAgreement {'),
      schema.indexOf('@@map("session_agreements")'),
    );
    expect(model).toMatch(/revisions\s+Json\?/);
    const erasure = readFileSync(resolve(process.cwd(), 'lib/dpdp-erasure.ts'), 'utf8');
    expect(erasure).toContain('tx.sessionAgreement.deleteMany({ where: { clientId } })');
    const exportRoute = readFileSync(
      resolve(process.cwd(), 'app/api/v1/clients/[id]/dsr/data-export/route.ts'),
      'utf8',
    );
    expect(exportRoute).toContain(
      'loadClientAgreementExport(tx, clientId, auth.value.psychologistId)',
    );
    expect(exportRoute).toContain('sessionAgreements,');
  });
});
