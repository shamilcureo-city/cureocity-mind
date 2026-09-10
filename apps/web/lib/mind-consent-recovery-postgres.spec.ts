import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionConsentSnapshotSchema } from '@cureocity/contracts';
import {
  MIND_CONSENT_RECOVERY_SCOPES,
  MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  MindConsentRecoveryReceiptSchema,
  MindConsentRecoveryStateSchema,
  type MindConsentRecoveryInput,
} from './mind-consent-recovery';

/**
 * Opt-in, disposable PostgreSQL integration checks, never an application DB.
 * Provision/migrate the isolated DB separately, then explicitly supply:
 * RUN_MIND_POSTGRES_TESTS=1 MIND_TEST_DATABASE_URL=postgresql://...@127.0.0.1:55439/cureocity_mind_test
 *
 * Only Firebase identity/capability resolution and telemetry are stubbed. The
 * actual route, Prisma native transactions, Client/Session locks, consent rows,
 * snapshot writes and audit persistence execute against real PostgreSQL.
 * Fixture rows are unique and retained; this file never deletes/truncates data.
 * Lock competitors model the persistence boundary, not the complete withdrawal
 * or erasure HTTP workflow. No microphone, gateway, KMS or production access.
 */
const identity = vi.hoisted(() => ({ psychologistId: '' }));
vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: async () => ({
    ok: true,
    value: { psychologistId: identity.psychologistId },
  }),
  requireCapability: async (_req: unknown, _capability: unknown, auth: unknown) => auth,
}));
vi.mock('@cureocity/observability/metrics', () => ({ recordAuditWrite: vi.fn() }));

// These imports must stay real: the database proxy remains lazy until beforeAll
// installs the explicitly validated, native Prisma client in its normal cache.
import { GET, POST } from '../app/api/v1/sessions/[id]/consent-recovery/route';
import { lockActiveClient } from './phi-write-lock';

function isolatedDatabaseUrl(raw: string | undefined): string {
  let parsed: URL;
  try {
    if (!raw) throw new Error('Missing explicit URL');
    parsed = new URL(raw);
  } catch {
    throw new Error('An explicit isolated MIND_TEST_DATABASE_URL is required');
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '55439' ||
    parsed.pathname !== '/cureocity_mind_test' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    // Never include a connection string or password in an assertion/error.
    throw new Error('Refusing a database outside the exact isolated local test target');
  }
  // Only the harness may add connection parameters; caller-supplied host/socket
  // overrides, alternate schemas and query options are deliberately forbidden.
  parsed.searchParams.set('connection_limit', '8');
  return parsed.toString();
}

describe('consent recovery PostgreSQL target guard (no database connection)', () => {
  it('accepts only the explicit disposable local target', () => {
    expect(
      isolatedDatabaseUrl('postgresql://fixture:fictional@127.0.0.1:55439/cureocity_mind_test'),
    ).toContain('127.0.0.1:55439/cureocity_mind_test?connection_limit=8');
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'postgresql://fixture:fictional@production.example:55439/cureocity_mind_test',
    'postgresql://fixture:fictional@localhost:55439/cureocity_mind_test',
    'postgresql://fixture:fictional@127.0.0.1:5432/cureocity_mind_test',
    'postgresql://fixture:fictional@127.0.0.1:55439/cureocity',
    'postgresql://fixture:fictional@127.0.0.1:55439/cureocity_mind_test?host=other.example',
    'postgresql://fixture:fictional@127.0.0.1:55439/cureocity_mind_test?schema=other',
    'postgresql://fixture:fictional@127.0.0.1:55439/cureocity_mind_test#fragment',
    'https://fixture:fictional@127.0.0.1:55439/cureocity_mind_test',
  ])('rejects an absent or non-isolated target %# before any connection', (raw) => {
    expect(() => isolatedDatabaseUrl(raw)).toThrow();
  });
});

const enabled = process.env['RUN_MIND_POSTGRES_TESTS'] === '1';
const confirmations = {
  AUDIO_RECORDING: true,
  AI_NOTE_GENERATION: true,
  CROSS_BORDER_PROCESSING: true,
} as const;
const snapshotBefore = {
  entries: [
    { scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', ackedAt: '2026-09-01T10:00:00Z' },
    {
      scope: 'DATA_RETENTION_EXTENDED',
      scriptVersion: 'v1.0',
      ackedAt: '2026-09-01T10:00:00Z',
    },
  ],
  notes: 'Fictional private consent discussion; preserve but do not copy to audit.',
};
type Fixture = { clientId: string; sessionId: string };
type Transaction = Prisma.TransactionClient;

describe.skipIf(!enabled)('consent recovery with real isolated PostgreSQL', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    // Validate before constructing a client or touching the lazy app proxy.
    const url = isolatedDatabaseUrl(process.env['MIND_TEST_DATABASE_URL']);
    if (globalThis.__cureocityPrisma !== undefined) {
      throw new Error('Refusing to reuse any existing application Prisma client');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [target] = await db.$queryRaw<{ database: string; server: string }[]>`
      SELECT current_database() AS database, inet_server_addr()::text AS server
    `;
    expect(target.database).toBe('cureocity_mind_test');
    globalThis.__cureocityPrisma = db;
  }, 20_000);

  afterAll(async () => {
    if (db) await db.$disconnect();
    if (globalThis.__cureocityPrisma === db) globalThis.__cureocityPrisma = undefined;
  });

  async function fixture(options: { scheduled?: boolean; currentBorderGrant?: boolean } = {}) {
    // The real migration permits only one demo client per practitioner, so
    // each sequential case receives an entirely separate fictional tenant.
    identity.psychologistId = randomUUID();
    await db.psychologist.create({
      data: {
        id: identity.psychologistId,
        firebaseUid: `fictional-${identity.psychologistId}`,
        email: `${identity.psychologistId}@test.invalid`,
        fullName: 'Fictional integration therapist',
        phone: `fixture-${identity.psychologistId}`,
        rciNumber: `fixture-${identity.psychologistId}`,
        status: 'ACTIVE',
        vertical: 'THERAPIST',
        role: 'THERAPIST',
      },
    });
    const clientId = randomUUID();
    const sessionId = randomUUID();
    await db.client.create({
      data: { id: clientId, psychologistId: identity.psychologistId, isDemo: true },
    });
    await db.session.create({
      data: {
        id: sessionId,
        clientId,
        psychologistId: identity.psychologistId,
        scheduledAt: new Date('2026-09-01T10:00:00Z'),
        startedAt: options.scheduled ? null : new Date('2026-09-01T10:05:00Z'),
        status: options.scheduled ? 'SCHEDULED' : 'IN_PROGRESS',
        consentSnapshot: snapshotBefore,
        noteDraft: { create: { content: { summary: 'Fictional held draft, unchanged.' } } },
      },
    });
    await db.consent.createMany({
      data: [
        {
          clientId,
          psychologistId: identity.psychologistId,
          scope: 'AUDIO_RECORDING',
          status: 'GRANTED',
          scriptVersion: 'v1.0',
          capturedVia: 'IN_PERSON',
          grantedAt: new Date('2026-09-01T10:00:00Z'),
        },
        {
          clientId,
          psychologistId: identity.psychologistId,
          scope: 'CROSS_BORDER_PROCESSING',
          status: options.currentBorderGrant ? 'GRANTED' : 'WITHDRAWN',
          scriptVersion: 'v1.0',
          capturedVia: 'IN_PERSON',
          grantedAt: new Date('2026-09-01T10:00:00Z'),
          withdrawnAt: options.currentBorderGrant ? null : new Date('2026-09-02T10:00:00Z'),
          notes: 'Fictional historical grant retained unchanged.',
        },
        {
          clientId,
          psychologistId: identity.psychologistId,
          scope: 'DATA_RETENTION_EXTENDED',
          status: 'EXPIRED',
          scriptVersion: 'v1.0',
          capturedVia: 'IN_PERSON',
          grantedAt: new Date('2026-08-01T10:00:00Z'),
          expiresAt: new Date('2026-09-01T10:00:00Z'),
        },
      ],
    });
    return { clientId, sessionId } satisfies Fixture;
  }

  const context = (f: Fixture) => ({ params: Promise.resolve({ id: f.sessionId }) });
  const request = (f: Fixture, body?: MindConsentRecoveryInput) =>
    new NextRequest(`http://localhost/api/v1/sessions/${f.sessionId}/consent-recovery`, {
      method: body ? 'POST' : 'GET',
      ...(body
        ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
    });
  async function inputFor(f: Fixture): Promise<MindConsentRecoveryInput> {
    const response = await GET(request(f), context(f));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const state = MindConsentRecoveryStateSchema.parse(await response.json());
    return { operationId: randomUUID(), expectedRevision: state.revision, confirmations };
  }
  const submit = (f: Fixture, input: MindConsentRecoveryInput) =>
    POST(request(f, input), context(f));
  const grantsFor = (f: Fixture) =>
    db.consent.findMany({ where: { clientId: f.clientId }, orderBy: { id: 'asc' } });
  const auditFor = (f: Fixture) =>
    db.auditLog.findMany({
      where: {
        actorPsychologistId: identity.psychologistId,
        OR: [
          { targetType: 'Session', targetId: f.sessionId },
          { metadata: { path: ['sessionId'], equals: f.sessionId } },
        ],
      },
      orderBy: { id: 'asc' },
    });
  const sessionFor = (f: Fixture) =>
    db.session.findUniqueOrThrow({ where: { id: f.sessionId }, include: { noteDraft: true } });

  async function waitForActualBlockedQuery(blockerPid: number) {
    const deadline = Date.now() + 2_000;
    do {
      const [row] = await db.$queryRaw<{ blocked: number }[]>`
        SELECT count(*)::int AS blocked FROM pg_stat_activity
        WHERE datname = current_database()
          AND ${blockerPid} = ANY(pg_blocking_pids(pid))
      `;
      if (row.blocked > 0) return;
      await delay(25);
    } while (Date.now() < deadline);
    throw new Error('Recovery did not reach an observable PostgreSQL lock wait');
  }

  async function compete(
    f: Fixture,
    input: MindConsentRecoveryInput,
    lock: (tx: Transaction) => Promise<unknown>,
    mutation: (tx: Transaction) => Promise<unknown>,
  ) {
    let unlock!: () => void;
    let reportLock!: (pid: number) => void;
    let reportFailure!: (error: unknown) => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const acquired = new Promise<number>((resolve, reject) => {
      reportLock = resolve;
      reportFailure = reject;
    });
    const competitor = db.$transaction(
      async (tx) => {
        await lock(tx);
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        reportLock(row.pid);
        await release;
        await mutation(tx);
      },
      { timeout: 10_000 },
    );
    void competitor.catch(reportFailure);
    let recovery: ReturnType<typeof submit> | undefined;
    try {
      const pid = await acquired;
      recovery = submit(f, input);
      // Observe a real blocked backend, not a timing assumption or mocked lock.
      await waitForActualBlockedQuery(pid);
    } finally {
      unlock();
      await competitor;
      // Drain the route promise even if the lock observation assertion failed.
      if (recovery) await recovery;
    }
    if (!recovery) throw new Error('Recovery was not started');
    return recovery;
  }

  it('persists prospective confirmations atomically and preserves history, optional retention and held draft', async () => {
    const f = await fixture();
    const before = await sessionFor(f);
    const oldGrants = await grantsFor(f);
    const input = await inputFor(f);
    expect(await sessionFor(f)).toEqual(before);
    expect(await auditFor(f)).toEqual([]);
    const earliest = Date.now();
    const response = await submit(f, input);
    const latest = Date.now();
    expect(response.status).toBe(200);
    const receipt = MindConsentRecoveryReceiptSchema.parse(await response.json());
    expect(receipt).toMatchObject({ sessionId: f.sessionId, ready: true, replayed: false });
    const after = await sessionFor(f);
    const snapshot = SessionConsentSnapshotSchema.parse(after.consentSnapshot);
    expect(snapshot.entries.slice(0, 2)).toEqual(snapshotBefore.entries);
    expect(snapshot.notes).toBe(snapshotBefore.notes);
    expect(snapshot.entries.slice(2).map((entry) => entry.scope)).toEqual(
      MIND_CONSENT_RECOVERY_SCOPES,
    );
    for (const entry of snapshot.entries.slice(2)) {
      expect(entry.scriptVersion).toBe(MIND_CONSENT_RECOVERY_SCRIPT_VERSION);
      expect(Date.parse(entry.ackedAt)).toBeGreaterThanOrEqual(earliest);
      expect(Date.parse(entry.ackedAt)).toBeLessThanOrEqual(latest);
    }
    expect({ ...after, consentSnapshot: null, updatedAt: null }).toEqual({
      ...before,
      consentSnapshot: null,
      updatedAt: null,
    });
    const allGrants = await grantsFor(f);
    expect(allGrants).toHaveLength(oldGrants.length + 2);
    for (const old of oldGrants) expect(allGrants.find((row) => row.id === old.id)).toEqual(old);
    const audits = await auditFor(f);
    expect(audits).toHaveLength(3);
    expect(audits.filter((row) => row.action === 'CONSENT_GRANTED')).toHaveLength(2);
    const recorded = audits.find((row) => row.action === 'SESSION_CONSENT_RECORDED');
    expect(recorded?.metadata).toMatchObject({
      operationId: input.operationId,
      resultRevision: receipt.revision,
      authorizesPreviousProcessing: false,
      authorizationAppliesFrom: snapshot.entries[2].ackedAt,
      previousSnapshot: snapshotBefore.entries,
    });
    expect(JSON.stringify(audits)).not.toContain(snapshotBefore.notes);
    expect(JSON.stringify(audits)).not.toContain('Fictional held draft');
  });

  it('does not start a scheduled session when saving confirmation', async () => {
    const f = await fixture({ scheduled: true });
    expect((await submit(f, await inputFor(f))).status).toBe(200);
    expect(await sessionFor(f)).toMatchObject({
      status: 'SCHEDULED',
      startedAt: null,
      endedAt: null,
    });
  });

  it('serializes concurrent duplicate operation IDs to exactly one commit', async () => {
    const f = await fixture();
    const input = await inputFor(f);
    const responses = await Promise.all([submit(f, input), submit(f, input)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const receipts = await Promise.all(
      responses.map(async (response) =>
        MindConsentRecoveryReceiptSchema.parse(await response.json()),
      ),
    );
    expect(receipts.map((receipt) => receipt.replayed).sort()).toEqual([false, true]);
    expect(receipts[0].revision).toBe(receipts[1].revision);
    expect(
      SessionConsentSnapshotSchema.parse((await sessionFor(f)).consentSnapshot).entries,
    ).toHaveLength(5);
    expect(await grantsFor(f)).toHaveLength(5);
    expect(await auditFor(f)).toHaveLength(3);
  });

  it('allows only one of two concurrent different operations with the same old revision', async () => {
    const f = await fixture();
    const input = await inputFor(f);
    const responses = await Promise.all([
      submit(f, input),
      submit(f, { ...input, operationId: randomUUID() }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await grantsFor(f)).toHaveLength(5);
    expect(await auditFor(f)).toHaveLength(3);
    expect(
      SessionConsentSnapshotSchema.parse((await sessionFor(f)).consentSnapshot).entries,
    ).toHaveLength(5);
  });

  it('does not regrant consent when a lost-ack retry follows an actual committed withdrawal', async () => {
    const f = await fixture();
    const input = await inputFor(f);
    expect((await submit(f, input)).status).toBe(200);
    await db.$transaction(async (tx) => {
      await lockActiveClient(tx, f.clientId, identity.psychologistId);
      await tx.consent.updateMany({
        where: { clientId: f.clientId, scope: 'CROSS_BORDER_PROCESSING', status: 'GRANTED' },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
    });
    const before = {
      session: await sessionFor(f),
      grants: await grantsFor(f),
      audits: await auditFor(f),
    };
    expect((await submit(f, input)).status).toBe(409);
    expect({
      session: await sessionFor(f),
      grants: await grantsFor(f),
      audits: await auditFor(f),
    }).toEqual(before);
  });

  it.each(['withdrawal', 'erasure'] as const)(
    'waits on the real Client row lock then rejects stale recovery after %s',
    async (change) => {
      const f = await fixture({ currentBorderGrant: true });
      const input = await inputFor(f);
      const before = await sessionFor(f);
      const response = await compete(
        f,
        input,
        (tx) => lockActiveClient(tx, f.clientId, identity.psychologistId),
        async (tx) => {
          if (change === 'erasure') {
            await tx.client.update({ where: { id: f.clientId }, data: { deletedAt: new Date() } });
          } else {
            await tx.consent.updateMany({
              where: { clientId: f.clientId, scope: 'CROSS_BORDER_PROCESSING', status: 'GRANTED' },
              data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
            });
          }
        },
      );
      expect(response.status).toBe(change === 'erasure' ? 404 : 409);
      expect(await sessionFor(f)).toEqual(before);
      expect(await grantsFor(f)).toHaveLength(3);
      expect(await auditFor(f)).toEqual([]);
    },
  );

  it('waits on the real Session row lock and refuses a lifecycle change committed while waiting', async () => {
    const f = await fixture();
    const input = await inputFor(f);
    const response = await compete(
      f,
      input,
      (tx) => tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${f.sessionId} FOR UPDATE`,
      (tx) =>
        tx.session.update({
          where: { id: f.sessionId },
          data: { status: 'COMPLETED', endedAt: new Date() },
        }),
    );
    expect(response.status).toBe(409);
    expect(await sessionFor(f)).toMatchObject({
      status: 'COMPLETED',
      consentSnapshot: snapshotBefore,
    });
    expect(await grantsFor(f)).toHaveLength(3);
    expect(await auditFor(f)).toEqual([]);
  });

  it('rolls back real snapshot, new grants and earlier audits when the final audit insert fails', async () => {
    const f = await fixture();
    const input = await inputFor(f);
    const before = { session: await sessionFor(f), grants: await grantsFor(f) };
    // Identifiers and target literal derive ONLY from an internally generated
    // UUID, never request input. This trigger affects this one fixture only.
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `mind_recovery_fail_${suffix}`;
    const triggerName = `mind_recovery_audit_${suffix}`;
    expect(functionName).toMatch(/^mind_recovery_fail_[a-f0-9]{32}$/);
    expect(triggerName).toMatch(/^mind_recovery_audit_[a-f0-9]{32}$/);
    expect(f.sessionId).toMatch(/^[a-f0-9-]{36}$/);
    let triggerCreated = false;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fictional consent audit persistence failure'; END;
      $$
    `);
    try {
      await db.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "audit_logs"
        FOR EACH ROW WHEN (NEW."targetId" = '${f.sessionId}' AND NEW."action" = 'SESSION_CONSENT_RECORDED')
        EXECUTE FUNCTION "${functionName}"()
      `);
      triggerCreated = true;
      await expect(submit(f, input)).rejects.toThrow('fictional consent audit persistence failure');
      expect({ session: await sessionFor(f), grants: await grantsFor(f) }).toEqual(before);
      expect(await auditFor(f)).toEqual([]);
    } finally {
      // Remove only these exact temporary test objects, never any data rows.
      if (triggerCreated)
        await db.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "audit_logs"`);
      await db.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });
});
