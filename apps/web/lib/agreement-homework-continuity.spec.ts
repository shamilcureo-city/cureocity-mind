import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateExerciseAssignmentInputSchema } from '@cureocity/contracts';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  session: vi.fn(),
  query: vi.fn(),
  agreement: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  existingKey: vi.fn(),
  existingRevision: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: m.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: m.audit }));
vi.mock('./mappers', () => ({ toExerciseAssignment: (row: unknown) => row }));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: m.client },
    session: { findFirst: m.session },
    $transaction: m.transaction,
  },
}));
import { POST } from '../app/api/v1/assignments/route';

const clientId = 'c' + '0'.repeat(23) + '1';
const sessionId = 'c' + '0'.repeat(23) + '2';
const agreementId = 'c' + '0'.repeat(23) + '3';
const input = {
  clientId,
  sourceSessionId: sessionId,
  sourceAgreementId: agreementId,
  sourceAgreementRevision: 0,
  idempotencyKey: '96856b74-d44e-48cb-8a77-79ef0c85b359',
  task: 'Try the fictional agreed step',
  frequency: 'Once before next visit',
  deliveryChannel: 'PORTAL_LINK',
};
let saved: Record<string, unknown>[];
let revision: number;
let retired: boolean;
let status: string;
const call = (body: unknown = input) =>
  POST(
    new Request('https://example.test/api/v1/assignments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  );

beforeEach(() => {
  vi.resetAllMocks();
  saved = [];
  revision = 0;
  retired = false;
  status = 'ACTIVE';
  m.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  m.client.mockResolvedValue({ id: clientId, psychologistId: 'psy-1', deletedAt: null });
  m.session.mockResolvedValue({ id: sessionId });
  m.query.mockImplementation(async (strings) =>
    String(strings).includes('FROM "clients"')
      ? [{ id: clientId, psychologistId: 'psy-1', deletedAt: null, status }]
      : [{ id: sessionId, status: 'COMPLETED' }],
  );
  m.agreement.mockImplementation(async () => ({
    id: agreementId,
    revision,
    retiredAt: retired ? new Date() : null,
    followUp: null,
  }));
  m.existingKey.mockImplementation(
    async ({ where }) => saved.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
  );
  m.existingRevision.mockImplementation(
    async ({ where }) =>
      saved.find(
        (row) =>
          row.sourceAgreementId === where.sourceAgreementId &&
          row.sourceAgreementRevision === where.sourceAgreementRevision,
      ) ?? null,
  );
  m.create.mockImplementation(async ({ data }) => {
    const row = {
      id: `saved-${saved.length}`,
      dueAt: null,
      frequency: null,
      deliveryChannel: null,
      therapistNote: null,
      ...data,
    };
    saved.push(row);
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
    const before = structuredClone(saved);
    try {
      return await fn({
        $queryRaw: m.query,
        $executeRaw: vi.fn(),
        sessionAgreement: { findFirst: m.agreement },
        exerciseAssignment: {
          create: m.create,
          findUnique: m.existingKey,
          findFirst: m.existingRevision,
        },
      });
    } catch (error) {
      saved = before;
      throw error;
    } finally {
      release();
    }
  });
});

describe('explicit agreement to homework continuity', () => {
  it('saves a separate reviewed snapshot with provenance and no notification or share write', async () => {
    expect((await call()).status).toBe(201);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      sourceAgreementId: agreementId,
      sourceAgreementRevision: 0,
      sourceSessionId: sessionId,
      source: 'CUSTOM',
      customDescription: input.task,
    });
    expect(m.audit).toHaveBeenCalledOnce();
    expect(m.audit.mock.calls[0]![0].metadata).toMatchObject({
      sourceAgreementId: agreementId,
      sourceAgreementRevision: 0,
    });
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain(input.task);
  });
  it('retries a lost response exactly once, including a new browser operation id', async () => {
    await call();
    expect((await call()).status).toBe(201);
    expect(
      (await call({ ...input, idempotencyKey: '9e705176-bb29-422b-aee2-455d67ef9be7' })).status,
    ).toBe(201);
    expect(saved).toHaveLength(1);
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it('serializes simultaneous conversion attempts to one assignment', async () => {
    expect((await Promise.all([call(), call()])).map((response) => response.status)).toEqual([
      201, 201,
    ]);
    expect(saved).toHaveLength(1);
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it('rejects changing task details under the same agreement revision', async () => {
    await call();
    expect(
      (
        await call({
          ...input,
          task: 'Different reviewed instruction',
          idempotencyKey: '9e705176-bb29-422b-aee2-455d67ef9be7',
        })
      ).status,
    ).toBe(409);
    expect(saved[0]!.customDescription).toBe(input.task);
  });
  it('does not silently rewrite homework when its agreement is corrected', async () => {
    await call();
    revision = 1;
    expect((await call()).status).toBe(201);
    expect(saved[0]!.sourceAgreementRevision).toBe(0);
    expect(saved[0]!.customDescription).toBe(input.task);
    expect((await call({ ...input, sourceAgreementRevision: 1 })).status).toBe(409);
  });
  it('rejects a new stale conversion after a correction', async () => {
    revision = 1;
    expect((await call()).status).toBe(409);
    expect(saved).toHaveLength(0);
  });
  it('rejects retired agreements without treating them as completed', async () => {
    retired = true;
    expect((await call()).status).toBe(409);
    expect(saved).toHaveLength(0);
  });
  it.each(['PAUSED', 'DISCHARGED', 'TRANSFERRED'])(
    'rejects %s clients under the write lock',
    async (next) => {
      status = next;
      expect((await call()).status).toBe(404);
      expect(m.create).not.toHaveBeenCalled();
    },
  );
  it('rejects a deleted or different-owner client after the initial read', async () => {
    m.query.mockResolvedValue([
      { id: clientId, psychologistId: 'other', status: 'ACTIVE', deletedAt: null },
    ]);
    expect((await call()).status).toBe(404);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('rejects a foreign-client agreement even when the session belongs to the caller', async () => {
    m.agreement.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(m.agreement).toHaveBeenCalledWith({
      where: { id: agreementId, sessionId, clientId, psychologistId: 'psy-1' },
    });
  });
  it('rolls back the assignment and its source link when audit writing fails', async () => {
    m.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(call()).rejects.toThrow('audit unavailable');
    expect(saved).toHaveLength(0);
  });
  it('keeps Doctor users outside this Mind-only route', async () => {
    m.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor', user: { vertical: 'DOCTOR' } },
    });
    expect((await call()).status).toBe(404);
    expect(m.client).not.toHaveBeenCalled();
  });
  it('requires source session, revision and a reviewed task together', () => {
    expect(CreateExerciseAssignmentInputSchema.safeParse(input).success).toBe(true);
    for (const key of [
      'sourceSessionId',
      'sourceAgreementId',
      'sourceAgreementRevision',
      'task',
    ] as const) {
      expect(
        CreateExerciseAssignmentInputSchema.safeParse({ ...input, [key]: undefined }).success,
      ).toBe(false);
    }
  });
});
