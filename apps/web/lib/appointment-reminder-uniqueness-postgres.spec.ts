import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Opt-in migration/Prisma tests against the exact disposable local database.
 * RUN_MIND_POSTGRES_TESTS=1 MIND_TEST_DATABASE_URL=postgresql://...@127.0.0.1:55439/cureocity_mind_test
 *
 * Each case gets an internally named schema and an index-free copy of the real
 * outbox table. No public rows/indexes, application client cache, reminder
 * workers, notifications or external services are touched. Fixture schemas and
 * fictional rows are retained for inspection; this suite deletes no data.
 */
const enabled = process.env['RUN_MIND_POSTGRES_TESTS'] === '1';
const indexName = 'appointment_reminder_delivery_identity_key';
const identityColumns = ['appointmentId', 'scheduledStartAt', 'kind', 'recipient'];
const root = resolve(process.cwd(), '../../prisma/migrations');

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
    // Never echo a connection string or password on failure.
    throw new Error('Refusing a database outside the exact isolated local test target');
  }
  parsed.searchParams.set('connection_limit', '8');
  return parsed.toString();
}

describe('reminder uniqueness PostgreSQL target guard (no database connection)', () => {
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

type Transaction = Prisma.TransactionClient;
type Fixture = { schema: string; client: PrismaClient };
type IndexMetadata = {
  oid: number;
  name: string;
  unique: boolean;
  valid: boolean;
  ready: boolean;
  immediate: boolean;
  partial: boolean;
  expression: boolean;
  keyCount: number;
  columns: string[];
};

describe.skipIf(!enabled)('reminder uniqueness with real isolated PostgreSQL', () => {
  let db: PrismaClient;
  let url: string;
  let migrationBody: string;
  const fixtureClients: PrismaClient[] = [];

  beforeAll(async () => {
    url = isolatedDatabaseUrl(process.env['MIND_TEST_DATABASE_URL']);
    // Prisma prepares one statement per call. Execute the unchanged migration
    // body through a single test-only DO/EXECUTE statement in the native
    // transaction. Only the migration's outer transaction wrappers are removed.
    const source = readFileSync(
      resolve(root, '20260926000600_reminder_delivery_uniqueness/migration.sql'),
      'utf8',
    );
    expect(source.match(/^BEGIN;\s*$/gm)).toHaveLength(1);
    expect(source.match(/^COMMIT;\s*$/gm)).toHaveLength(1);
    migrationBody = source.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
    expect(migrationBody).not.toContain('$fixture_migration$');
    expect(migrationBody).not.toContain('$fixture_source$');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [target] = await db.$queryRaw<{ database: string; server: string }[]>`
      SELECT current_database() AS database, host(inet_server_addr()) AS server
    `;
    expect(target.database).toBe('cureocity_mind_test');
    expect(target.server).toBe('127.0.0.1');
  }, 20_000);

  afterEach(async () => {
    // Retain fixture data, not idle connection pools in the small local server.
    await Promise.all(fixtureClients.splice(0).map((client) => client.$disconnect()));
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  async function fixture(): Promise<Fixture> {
    const schema = `reminder_test_${randomUUID().replaceAll('-', '')}`;
    expect(schema).toMatch(/^reminder_test_[a-f0-9]{32}$/);
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    // LIKE copies column types, NOT NULL and defaults but deliberately excludes
    // indexes and foreign keys. We can test the actual table shape without any
    // real Appointment rows or inherited public uniqueness protection.
    await db.$executeRawUnsafe(
      `CREATE TABLE "${schema}"."appointment_reminder_deliveries" (LIKE public."appointment_reminder_deliveries" INCLUDING DEFAULTS)`,
    );
    // Prisma schema-qualifies enum parameter casts. These fixture-only aliases
    // preserve the exact real enum values/types without copying or changing
    // public enums or the LIKE-cloned columns.
    for (const type of [
      'AppointmentReminderKind',
      'AppointmentReminderRecipient',
      'AppointmentReminderDeliveryStatus',
    ]) {
      await db.$executeRawUnsafe(`CREATE DOMAIN "${schema}"."${type}" AS public."${type}"`);
    }
    // Only this harness may add a schema query parameter after validating the
    // caller URL. The generated Prisma client then addresses the fixture schema.
    const fixtureUrl = new URL(url);
    fixtureUrl.searchParams.set('schema', schema);
    const client = new PrismaClient({ datasources: { db: { url: fixtureUrl.toString() } } });
    fixtureClients.push(client);
    await client.$connect();
    return { schema, client };
  }

  async function inFixture<T>(f: Fixture, action: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${f.schema}", public`);
        return action(tx);
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }

  async function executeMigration(tx: Transaction) {
    await tx.$executeRawUnsafe(`
      DO $fixture_migration$
      BEGIN
        EXECUTE $fixture_source$${migrationBody}$fixture_source$;
      END
      $fixture_migration$;
    `);
  }
  const migrate = (f: Fixture) => inFixture(f, executeMigration);
  const rows = (f: Fixture) =>
    db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${f.schema}"."appointment_reminder_deliveries" ORDER BY "id"`,
    );
  async function indexMetadata(f: Fixture) {
    return db.$queryRaw<IndexMetadata[]>`
      SELECT index_class.oid::int AS oid, index_class.relname AS name,
        index.indisunique AS unique, index.indisvalid AS valid,
        index.indisready AS ready, index.indimmediate AS immediate,
        (index.indpred IS NOT NULL) AS partial,
        (index.indexprs IS NOT NULL) AS expression,
        index.indnkeyatts::int AS "keyCount",
        ARRAY(
          SELECT attribute.attname::text
          FROM unnest(index.indkey) WITH ORDINALITY AS key(attnum, position)
          LEFT JOIN pg_attribute AS attribute
            ON attribute.attrelid = index.indrelid AND attribute.attnum = key.attnum
          ORDER BY key.position
        ) AS columns
      FROM pg_index AS index
      JOIN pg_class AS index_class ON index_class.oid = index.indexrelid
      JOIN pg_class AS table_class ON table_class.oid = index.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
      WHERE namespace.nspname = ${f.schema}
        AND table_class.relname = 'appointment_reminder_deliveries'
      ORDER BY index_class.relname
    `;
  }
  function delivery(overrides: Partial<Prisma.AppointmentReminderDeliveryCreateManyInput> = {}) {
    return {
      id: randomUUID(),
      appointmentId: `fictional-${randomUUID()}`,
      scheduledStartAt: new Date('2026-09-10T12:00:00Z'),
      kind: 'H24',
      recipient: 'PRACTITIONER_EMAIL',
      status: 'PENDING',
      ...overrides,
    } satisfies Prisma.AppointmentReminderDeliveryCreateManyInput;
  }

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
    throw new Error('Expected competitor did not reach an observable PostgreSQL lock wait');
  }

  it('creates the exact four-column unique index on a clean table and replays without changing it', async () => {
    const f = await fixture();
    expect(await indexMetadata(f)).toEqual([]);
    await migrate(f);
    const [index] = await indexMetadata(f);
    expect(index).toEqual({
      oid: expect.any(Number),
      name: indexName,
      unique: true,
      valid: true,
      ready: true,
      immediate: true,
      partial: false,
      expression: false,
      keyCount: 4,
      columns: identityColumns,
    });
    expect(Buffer.byteLength(indexName)).toBeLessThanOrEqual(63);
    await f.client.appointmentReminderDelivery.createMany({ data: [delivery()] });
    const before = await rows(f);
    await migrate(f);
    expect(await indexMetadata(f)).toEqual([index]);
    expect(await rows(f)).toEqual(before);
  });

  it('native Prisma skipDuplicates suppresses duplicate identities while allowing recipient, kind, schedule and appointment changes', async () => {
    const f = await fixture();
    await migrate(f);
    const original = delivery();
    const result = await f.client.appointmentReminderDelivery.createMany({
      skipDuplicates: true,
      data: [
        original,
        { ...original, id: randomUUID() },
        { ...original, id: randomUUID(), recipient: 'PATIENT_EMAIL' },
        { ...original, id: randomUUID(), kind: 'H2' },
        { ...original, id: randomUUID(), scheduledStartAt: new Date('2026-09-11T12:00:00Z') },
        { ...original, id: randomUUID(), appointmentId: `fictional-${randomUUID()}` },
      ],
    });
    expect(result.count).toBe(5);
    expect(await rows(f)).toHaveLength(5);
  });

  it('native concurrent Prisma enqueues commit exactly one delivery for the same identity', async () => {
    const f = await fixture();
    await migrate(f);
    const original = delivery();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.client.appointmentReminderDelivery.createMany({
          skipDuplicates: true,
          data: [{ ...original, id: randomUUID() }],
        }),
      ),
    );
    expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(1);
    expect(await rows(f)).toHaveLength(1);
  });

  it('fails duplicate preflight without deleting, merging, cancelling or altering any reminder history', async () => {
    const f = await fixture();
    const original = delivery();
    const statuses = [
      'PENDING',
      'IN_FLIGHT',
      'DISPATCHING',
      'SUBMISSION_STARTED',
      'UNKNOWN',
      'DELIVERED',
      'FAILED',
      'CANCELLED',
    ] as const;
    await f.client.appointmentReminderDelivery.createMany({
      data: statuses.map((status, position) => ({
        ...original,
        id: randomUUID(),
        status,
        attemptCount: position,
        lastError: `fictional-history-${position}`,
        leaseExpiresAt: new Date('2026-09-10T12:05:00Z'),
        submissionStartedAt: new Date('2026-09-10T11:55:00Z'),
        deliveredAt: status === 'DELIVERED' ? new Date('2026-09-10T11:56:00Z') : null,
      })),
    });
    const before = await rows(f);
    await expect(migrate(f)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23505' } });
    expect(await rows(f)).toEqual(before);
    expect(await indexMetadata(f)).toEqual([]);
  });

  it.each([
    [
      'wrong columns',
      `CREATE UNIQUE INDEX "${indexName}" ON "appointment_reminder_deliveries" ("appointmentId")`,
    ],
    [
      'non-unique',
      `CREATE INDEX "${indexName}" ON "appointment_reminder_deliveries" ("appointmentId", "scheduledStartAt", "kind", "recipient")`,
    ],
    [
      'partial',
      `CREATE UNIQUE INDEX "${indexName}" ON "appointment_reminder_deliveries" ("appointmentId", "scheduledStartAt", "kind", "recipient") WHERE "status" = 'PENDING'`,
    ],
    [
      'expression',
      `CREATE UNIQUE INDEX "${indexName}" ON "appointment_reminder_deliveries" (lower("appointmentId"), "scheduledStartAt", "kind", "recipient")`,
    ],
    [
      'wrong column order',
      `CREATE UNIQUE INDEX "${indexName}" ON "appointment_reminder_deliveries" ("appointmentId", "scheduledStartAt", "recipient", "kind")`,
    ],
    [
      'additional included column',
      `CREATE UNIQUE INDEX "${indexName}" ON "appointment_reminder_deliveries" ("appointmentId", "scheduledStartAt", "kind", "recipient") INCLUDE ("status")`,
    ],
  ])(
    'rejects an existing canonical-name index with %s rather than trusting IF NOT EXISTS',
    async (_kind, ddl) => {
      const f = await fixture();
      await f.client.appointmentReminderDelivery.createMany({ data: [delivery()] });
      await inFixture(f, (tx) => tx.$executeRawUnsafe(ddl));
      const beforeRows = await rows(f);
      const beforeIndexes = await indexMetadata(f);
      await expect(migrate(f)).rejects.toThrow();
      expect(await rows(f)).toEqual(beforeRows);
      expect(await indexMetadata(f)).toEqual(beforeIndexes);
    },
  );

  it('reproduces the historical PostgreSQL 63-byte index-name collision using the original SQL statements', async () => {
    const f = await fixture();
    const scheduledName = 'appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_key';
    const recipientName =
      'appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_recipient_key';
    expect(scheduledName.slice(0, 63)).toBe(recipientName.slice(0, 63));
    const scheduledSource = readFileSync(
      resolve(root, '20260917000000_appointment_reminder_schedule_version/migration.sql'),
      'utf8',
    );
    const recipientSource = readFileSync(
      resolve(root, '20260920000000_appointment_reminder_recipient_delivery/migration.sql'),
      'utf8',
    );
    const scheduledCreate = scheduledSource.match(
      new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${scheduledName}"[^;]+;`),
    )?.[0];
    const recipientCreate = recipientSource.match(
      new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${recipientName}"[^;]+;`),
    )?.[0];
    const scheduledDrop = recipientSource.match(
      new RegExp(`DROP INDEX IF EXISTS "${scheduledName}";`),
    )?.[0];
    expect(scheduledCreate).toBeDefined();
    expect(recipientCreate).toBeDefined();
    expect(scheduledDrop).toBeDefined();
    await inFixture(f, async (tx) => {
      await tx.$executeRawUnsafe(scheduledCreate!);
      await tx.$executeRawUnsafe(recipientCreate!);
    });
    const [wrongIndex] = await indexMetadata(f);
    expect(wrongIndex.columns).toEqual(identityColumns.slice(0, 3));
    await inFixture(f, (tx) => tx.$executeRawUnsafe(scheduledDrop!));
    expect(await indexMetadata(f)).toEqual([]);
    const original = delivery();
    const reproduced = await f.client.appointmentReminderDelivery.createMany({
      skipDuplicates: true,
      data: [original, { ...original, id: randomUUID() }],
    });
    expect(reproduced.count).toBe(2);
    const before = await rows(f);
    await expect(migrate(f)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23505' } });
    expect(await rows(f)).toEqual(before);
  });

  it('rejects a same-name index on another fixture table and leaves that object untouched', async () => {
    const f = await fixture();
    await inFixture(f, async (tx) => {
      await tx.$executeRawUnsafe('CREATE TABLE "other_fixture" ("id" text NOT NULL)');
      await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX "${indexName}" ON "other_fixture" ("id")`);
    });
    const object = () => db.$queryRaw<{ oid: number; definition: string }[]>`
      SELECT index_class.oid::int AS oid, pg_get_indexdef(index_class.oid) AS definition
      FROM pg_class AS index_class
      JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
      WHERE namespace.nspname = ${f.schema} AND index_class.relname = ${indexName}
    `;
    const before = await object();
    expect(before).toHaveLength(1);
    await expect(migrate(f)).rejects.toThrow(/unexpected definition/i);
    expect(await object()).toEqual(before);
    expect(await indexMetadata(f)).toEqual([]);
  });

  it('rejects nullable identity columns even when no existing duplicate is visible', async () => {
    const f = await fixture();
    await f.client.appointmentReminderDelivery.createMany({ data: [delivery()] });
    await inFixture(f, (tx) =>
      tx.$executeRawUnsafe(
        'ALTER TABLE "appointment_reminder_deliveries" ALTER COLUMN "recipient" DROP NOT NULL',
      ),
    );
    const before = await rows(f);
    await expect(migrate(f)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23502' } });
    expect(await rows(f)).toEqual(before);
    expect(await indexMetadata(f)).toEqual([]);
  });

  it('blocks a concurrent enqueue until migration commits, then applies uniqueness without an unprotected write gap', async () => {
    const f = await fixture();
    const original = delivery();
    let unlock!: () => void;
    let reportPid!: (pid: number) => void;
    let reportFailure!: (error: unknown) => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const acquired = new Promise<number>((resolve, reject) => {
      reportPid = resolve;
      reportFailure = reject;
    });
    const migration = inFixture(f, async (tx) => {
      await executeMigration(tx);
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      reportPid(backend.pid);
      await release;
    });
    void migration.catch(reportFailure);
    let writer: Promise<Prisma.BatchPayload> | undefined;
    try {
      const pid = await acquired;
      // Calling then starts the lazy Prisma operation immediately.
      writer = f.client.appointmentReminderDelivery
        .createMany({
          skipDuplicates: true,
          data: [original, { ...original, id: randomUUID() }],
        })
        .then((result) => result);
      // Attach rejection handling immediately; finally still awaits the
      // original promise and reports any failure instead of swallowing it.
      void writer.catch(() => undefined);
      await waitForActualBlockedQuery(pid);
    } finally {
      unlock();
      await migration;
      if (writer) await writer;
    }
    expect(await writer).toEqual({ count: 1 });
    expect(await rows(f)).toHaveLength(1);
  }, 15_000);

  it('waits for an already-writing transaction before preflight and rejects its committed duplicate without changing it', async () => {
    const f = await fixture();
    const original = delivery();
    await f.client.appointmentReminderDelivery.createMany({ data: [original] });
    let unlock!: () => void;
    let reportPid!: (pid: number) => void;
    let reportFailure!: (error: unknown) => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const acquired = new Promise<number>((resolve, reject) => {
      reportPid = resolve;
      reportFailure = reject;
    });
    const writer = f.client.$transaction(
      async (tx) => {
        await tx.appointmentReminderDelivery.createMany({
          data: [{ ...original, id: randomUUID(), status: 'DELIVERED', attemptCount: 1 }],
        });
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        reportPid(backend.pid);
        await release;
      },
      { timeout: 15_000 },
    );
    void writer.catch(reportFailure);
    let migration: Promise<void> | undefined;
    let migrationFailure: unknown;
    try {
      const pid = await acquired;
      migration = migrate(f).catch((error: unknown) => {
        migrationFailure = error;
      });
      await waitForActualBlockedQuery(pid);
    } finally {
      unlock();
      await writer;
      if (migration) await migration;
    }
    expect(migrationFailure).toMatchObject({ code: 'P2010', meta: { code: '23505' } });
    const after = await rows(f);
    expect(after).toHaveLength(2);
    expect(after.map((row) => row.status).sort()).toEqual(['DELIVERED', 'PENDING']);
    expect(after.map((row) => row.attemptCount).sort()).toEqual([0, 1]);
    expect(await indexMetadata(f)).toEqual([]);
  }, 15_000);
});
