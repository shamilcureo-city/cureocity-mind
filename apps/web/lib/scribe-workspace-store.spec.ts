import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  session: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: m.auth }));
vi.mock('./prisma', () => ({
  prisma: {
    scribeWorkspaceRecord: m,
    $transaction: m.transaction,
  },
}));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: m.encrypt, decryptForTenant: m.decrypt }));
vi.mock('./audit', () => ({ writeAudit: m.audit }));
vi.mock('./phi-write-lock', () => ({
  lockActiveClient: m.lock,
  ClientPhiWriteForbiddenError: class extends Error {},
}));
import {
  createScribeRecord,
  deleteScribeRecord,
  getScribeRecord,
  listScribeRecords,
  updateScribeRecord,
} from './scribe-workspace-store';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from './scribe-workspace-auth';

const body = { text: 'Fictional task only' };
const schema = z.object({ text: z.string() });
const scope = {
  psychologistId: 'doctor-1',
  kind: 'task' as const,
  clientId: 'patient-1',
  sessionId: 'visit-1',
};
const row = {
  id: 'record-1',
  psychologistId: scope.psychologistId,
  clientId: scope.clientId,
  sessionId: scope.sessionId,
  kind: scope.kind,
  bodyEncrypted: 'opaque-envelope',
  revision: 1,
  createdAt: new Date('2026-09-25T09:00:00Z'),
  updatedAt: new Date('2026-09-25T09:00:00Z'),
};
const tx = { scribeWorkspaceRecord: m, session: { findUnique: m.session }, $queryRaw: m.query };

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(async (fn) => fn(tx));
  m.lock.mockResolvedValue({ id: scope.clientId, psychologistId: scope.psychologistId });
  m.query.mockResolvedValue([{ id: 'doctor-1' }]);
  m.session.mockResolvedValue({
    clientId: scope.clientId,
    psychologistId: scope.psychologistId,
    therapyNote: null,
  });
  m.findFirst.mockResolvedValue(row);
  m.findMany.mockResolvedValue([row]);
  m.create.mockResolvedValue(row);
  m.count.mockResolvedValue(0);
  m.updateMany.mockResolvedValue({ count: 1 });
  m.deleteMany.mockResolvedValue({ count: 1 });
  m.findUniqueOrThrow.mockResolvedValue({ ...row, revision: 2 });
  m.encrypt.mockResolvedValue('opaque-envelope');
  m.decrypt.mockResolvedValue(JSON.stringify(body));
  m.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-1', user: { vertical: 'DOCTOR' } },
  });
});

describe('encrypted Scribe workspace lifecycle', () => {
  it('reads only the requested tenant/kind and never erased patient rows', async () => {
    const result = await listScribeRecords(scope, schema);
    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          psychologistId: 'doctor-1',
          kind: 'task',
          clientId: 'patient-1',
          sessionId: 'visit-1',
          OR: [{ clientId: null }, { client: { deletedAt: null, psychologistId: 'doctor-1' } }],
        }),
      }),
    );
    expect(result[0]).toMatchObject({ body, revision: 1 });
    expect(result[0]).not.toHaveProperty('bodyEncrypted');
  });

  it('rejects malformed/undecryptable saved bodies rather than silently returning defaults', async () => {
    m.decrypt.mockResolvedValue(null);
    await expect(getScribeRecord(scope, row.id, schema)).rejects.toMatchObject({ status: 503 });
    m.decrypt.mockResolvedValue('{');
    await expect(getScribeRecord(scope, row.id, schema)).rejects.toMatchObject({ status: 503 });
    m.decrypt.mockResolvedValue('{"unrecognised":"value"}');
    await expect(getScribeRecord(scope, row.id, schema)).rejects.toMatchObject({ status: 503 });
  });

  it('encrypts before persistence, locks the patient, and audits no narrative', async () => {
    const result = await createScribeRecord(scope, body, 'record-1');
    expect(m.encrypt).toHaveBeenCalledWith('doctor-1', JSON.stringify(body));
    expect(m.lock).toHaveBeenCalledWith(tx, 'patient-1', 'doctor-1');
    expect(m.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bodyEncrypted: 'opaque-envelope' }),
    });
    expect(JSON.stringify(m.create.mock.calls)).not.toContain(body.text);
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain(body.text);
    expect(result.body).toEqual(body);
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0]!);
  });

  it('does not write when the patient lock fails or encounter ownership mismatches', async () => {
    m.lock.mockRejectedValueOnce(new Error('erased'));
    await expect(createScribeRecord(scope, body)).rejects.toThrow('erased');
    m.session.mockResolvedValueOnce({ clientId: 'other-patient', psychologistId: 'doctor-1' });
    await expect(createScribeRecord(scope, body)).rejects.toMatchObject({ status: 404 });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('rejects patient-free clinical records and patient-bound reusable preferences', async () => {
    await expect(
      createScribeRecord({ psychologistId: 'doctor-1', kind: 'task' }, body),
    ).rejects.toMatchObject({ status: 400 });
    await expect(createScribeRecord({ ...scope, kind: 'shortcut' }, body)).rejects.toMatchObject({
      status: 400,
    });
    await expect(createScribeRecord({ ...scope, kind: 'template' }, body)).rejects.toMatchObject({
      status: 400,
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('rejects signed encounter writes when the route requires an unsigned source', async () => {
    m.session.mockResolvedValue({
      clientId: scope.clientId,
      psychologistId: scope.psychologistId,
      therapyNote: { signedAt: new Date() },
    });
    await expect(
      createScribeRecord({ ...scope, requireUnsigned: true }, body),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('runs the server freshness/consent guard under the lifecycle locks', async () => {
    const guard = vi.fn().mockRejectedValue(new ScribeWorkspaceError(409, 'Source changed'));
    await expect(updateScribeRecord({ ...scope, guard }, row.id, 1, body)).rejects.toThrow(
      'Source changed',
    );
    expect(guard).toHaveBeenCalledWith(tx);
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(guard.mock.invocationCallOrder[0]!);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('uses compare-and-swap and preserves the stored patient scope on edits', async () => {
    const result = await updateScribeRecord(
      { psychologistId: 'doctor-1', kind: 'task' },
      row.id,
      1,
      body,
    );
    expect(m.lock).toHaveBeenCalledWith(tx, 'patient-1', 'doctor-1');
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: row.id,
          revision: 1,
          clientId: 'patient-1',
          sessionId: 'visit-1',
        }),
        data: { bodyEncrypted: 'opaque-envelope', revision: { increment: 1 } },
      }),
    );
    expect(result.revision).toBe(2);
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(updateScribeRecord(scope, row.id, 1, body)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects stale deletes and prevents cross-owner record guessing', async () => {
    m.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(deleteScribeRecord(scope, row.id, 1)).rejects.toMatchObject({ status: 409 });
    m.findFirst.mockResolvedValueOnce(null);
    await expect(updateScribeRecord(scope, 'guessed-id', 1, body)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('labels token-authorised intake writes as system, not doctor-authored', async () => {
    await updateScribeRecord({ ...scope, kind: 'intake', actorType: 'SYSTEM' }, row.id, 1, body);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'SYSTEM' }), tx);
    expect(m.audit.mock.calls[0]?.[0]).not.toHaveProperty('actorPsychologistId');
  });

  it('bounds saved bodies and record counts', async () => {
    await expect(
      createScribeRecord(scope, { text: 'x'.repeat(4 * 1024 * 1024) }),
    ).rejects.toMatchObject({ status: 413 });
    m.count.mockResolvedValue(500);
    await expect(createScribeRecord(scope, body)).rejects.toMatchObject({ status: 409 });
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe('Scribe route authority', () => {
  it('checks the requested capability and doctor vertical', async () => {
    await requireScribeDoctor({} as never, 'PRESCRIPTION_DRAFTING');
    expect(m.auth).toHaveBeenCalledWith({}, 'PRESCRIPTION_DRAFTING');
    m.auth.mockResolvedValueOnce({ ok: true, value: { user: { vertical: 'THERAPIST' } } });
    expect(await requireScribeDoctor({} as never)).toMatchObject({
      ok: false,
      response: { status: 403 },
    });
  });

  it('preserves authentication/capability denials and hides internal failures', async () => {
    const denial = { ok: false, response: new Response(null, { status: 401 }) };
    m.auth.mockResolvedValue(denial);
    expect(await requireScribeDoctor({} as never)).toBe(denial);
    const response = scribeErrorResponse(new Error('private token and database URL'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
  });
});
