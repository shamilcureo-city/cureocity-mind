import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  canonicalSessionUsagePayload,
  SessionUsageReceiptSchema,
  type SessionUsageReceipt,
} from '@cureocity/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { lockActiveClient } from './phi-write-lock';
import { loadSessionUsageDataExport } from './session-usage-data-export';
import { eraseClientPhi } from './dpdp-erasure';

// Opt-in, disposable PostgreSQL only. The compatible schema must be explicitly
// applied by the test operator first; this suite does not apply migrations.
function isolatedUrl(raw: string | undefined) {
  if (!raw) throw new Error('Explicit isolated usage test database required');
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    url.pathname !== '/cureocity_mind_test' ||
    url.search ||
    url.hash
  )
    throw new Error('Refusing non-isolated database');
  url.searchParams.set('connection_limit', '6');
  return url.toString();
}
it('refuses implicit, production and parameter-overridden usage database targets', () => {
  expect(() => isolatedUrl(undefined)).toThrow();
  expect(() => isolatedUrl('postgresql://test:test@production.invalid/db')).toThrow();
  expect(() =>
    isolatedUrl('postgresql://test:test@127.0.0.1:55439/cureocity_mind_test?host=production'),
  ).toThrow();
});

describe.skipIf(process.env['RUN_SESSION_USAGE_POSTGRES_TESTS'] !== '1')(
  'usage constraints and erasure serialization on isolated PostgreSQL',
  () => {
    let db: PrismaClient;
    beforeAll(async () => {
      db = new PrismaClient({
        datasources: { db: { url: isolatedUrl(process.env['SESSION_USAGE_TEST_DATABASE_URL']) } },
      });
      await db.$connect();
      const [target] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
      expect(target?.name).toBe('cureocity_mind_test');
    });
    afterAll(async () => {
      if (db) await db.$disconnect();
    });
    async function fixture() {
      const psychologistId = randomUUID();
      await db.psychologist.create({
        data: {
          id: psychologistId,
          firebaseUid: `fixture-${psychologistId}`,
          email: `${psychologistId}@test.invalid`,
          fullName: 'Fictional usage tester',
          phone: `fixture-${psychologistId}`,
          rciNumber: `fixture-${psychologistId}`,
          status: 'ACTIVE',
          vertical: 'THERAPIST',
        },
      });
      const client = await db.client.create({ data: { psychologistId, isDemo: true } });
      const session = await db.session.create({
        data: {
          clientId: client.id,
          psychologistId,
          scheduledAt: new Date(),
          status: 'IN_PROGRESS',
        },
      });
      const registration = {
        connectionId: randomUUID(),
        sessionId: session.id,
        psychologistId,
        clientId: client.id,
        vertical: 'THERAPIST',
        backend: 'vertex',
        startedAt: new Date('2026-09-13T09:00:00.000Z'),
      };
      return { client, session, registration };
    }
    function receiptFor(
      registration: Awaited<ReturnType<typeof fixture>>['registration'],
      overrides: Partial<SessionUsageReceipt> = {},
    ) {
      return SessionUsageReceiptSchema.parse({
        version: 1,
        domain: 'CUREOCITY_LIVE_USAGE_V1',
        type: 'RECEIPT',
        connectionId: registration.connectionId,
        sessionId: registration.sessionId,
        psychologistId: registration.psychologistId,
        vertical: 'THERAPIST',
        sequence: 1,
        state: 'OPEN',
        endedAt: null,
        totals: {
          inputTokens: 10,
          outputTokens: 20,
          pass1Calls: 1,
          pass2Calls: 0,
          reasoningCalls: 0,
          unknownCalls: 0,
          costInr: '0.1000',
          transcriptionInr: '0.1000',
          notesInr: '0.0000',
          reasoningInr: '0.0000',
        },
        usageBasis: 'LOCAL_ESTIMATE',
        coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS'],
        provenance: {
          models: [],
          regions: [],
          promptVersions: [],
          pricingVersion: null,
          configurationVersion: null,
        },
        ...overrides,
      });
    }
    const receiptData = (receipt: SessionUsageReceipt) => ({
      lastSequence: receipt.sequence,
      state: receipt.state,
      endedAt: receipt.endedAt ? new Date(receipt.endedAt) : null,
      lastReceipt: receipt,
      costInr: receipt.totals.costInr,
      lastPayloadHash: createHash('sha256')
        .update(canonicalSessionUsagePayload(receipt))
        .digest('hex'),
    });
    it('rejects mismatched or erased owners and reassignment of a registered visit', async () => {
      const first = await fixture();
      const other = await fixture();
      await expect(
        db.sessionUsageConnection.create({
          data: { ...first.registration, psychologistId: other.registration.psychologistId },
        }),
      ).rejects.toThrow();
      await expect(
        db.sessionUsageConnection.create({
          data: { ...first.registration, clientId: other.client.id },
        }),
      ).rejects.toThrow();
      const saved = await db.sessionUsageConnection.create({ data: first.registration });
      expect(saved.costInr).toBeNull();
      expect(saved.lastReceipt).toBeNull();
      await expect(
        db.session.update({ where: { id: first.session.id }, data: { clientId: other.client.id } }),
      ).rejects.toThrow();
      await db.client.update({ where: { id: first.client.id }, data: { deletedAt: new Date() } });
      await expect(
        db.sessionUsageConnection.create({
          data: { ...first.registration, connectionId: randomUUID() },
        }),
      ).rejects.toThrow();
      await expect(
        db.sessionUsageConnection.update({
          where: { connectionId: saved.connectionId },
          data: receiptData(receiptFor(first.registration)),
        }),
      ).rejects.toThrow();
    });
    it('rejects malformed registration/receipt evidence, nonmonotonic counts, and final overwrites', async () => {
      const { registration } = await fixture();
      await expect(
        db.sessionUsageConnection.create({ data: { ...registration, costInr: '0.0000' } }),
      ).rejects.toThrow();
      await db.sessionUsageConnection.create({ data: registration });
      const where = { connectionId: registration.connectionId };
      await expect(
        db.sessionUsageConnection.update({
          where,
          data: { lastSequence: 1, lastPayloadHash: 'a'.repeat(64), lastReceipt: {}, costInr: 0 },
        }),
      ).rejects.toThrow();
      const first = receiptFor(registration);
      await db.sessionUsageConnection.update({ where, data: receiptData(first) });
      await expect(
        db.sessionUsageConnection.update({ where, data: receiptData(first) }),
      ).rejects.toThrow();
      await expect(
        db.sessionUsageConnection.update({
          where,
          data: receiptData({ ...first, sequence: 2, totals: { ...first.totals, inputTokens: 9 } }),
        }),
      ).rejects.toThrow();
      const final = receiptFor(registration, {
        sequence: 2,
        state: 'FINAL_REPORTED',
        endedAt: '2026-09-13T09:01:00.000Z',
      });
      await db.sessionUsageConnection.update({ where, data: receiptData(final) });
      await expect(
        db.sessionUsageConnection.update({ where, data: receiptData({ ...final, sequence: 3 }) }),
      ).rejects.toThrow();
    });
    it('exports reported, unreported and zero usage with the flag off, then fully erases every connection', async () => {
      const { registration, client, session } = await fixture();
      const metered = { ...registration, connectionId: randomUUID() };
      const mock = { ...registration, connectionId: randomUUID(), backend: 'mock' };
      for (const data of [registration, metered, mock]) {
        await db.sessionUsageConnection.create({ data });
      }
      const partial = receiptFor(metered, {
        state: 'INCOMPLETE',
        endedAt: '2026-09-13T09:01:00.000Z',
        coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS', 'INTERRUPTED'],
      });
      await db.sessionUsageConnection.update({
        where: { connectionId: metered.connectionId },
        data: receiptData(partial),
      });
      const zero = receiptFor(mock, {
        state: 'FINAL_REPORTED',
        endedAt: '2026-09-13T09:01:00.000Z',
        usageBasis: 'MOCK_ZERO',
        coverageReasons: [],
        totals: { ...partial.totals, costInr: '0.0000', transcriptionInr: '0.0000' },
      });
      await db.sessionUsageConnection.update({
        where: { connectionId: mock.connectionId },
        data: receiptData(zero),
      });
      vi.stubEnv('SESSION_USAGE_RECEIPTS_ENABLED', 'false');
      try {
        const exported = await db.$transaction((tx) =>
          loadSessionUsageDataExport(tx, client.id, registration.psychologistId),
        );
        expect(exported).toHaveLength(3);
        expect(exported.map((row) => row.totals?.costInr ?? null)).toEqual(
          expect.arrayContaining([null, '0.1000', '0.0000']),
        );
        expect(exported.find((row) => row.state === 'INCOMPLETE')?.coverageReasons).toContain(
          'INTERRUPTED',
        );
        expect(JSON.stringify(exported)).not.toMatch(
          /connectionId|lastPayloadHash|psychologistId|lastSequence|serviceSecret/,
        );
        const erasure = await db.clientErasureRequest.create({
          data: { clientId: client.id, reason: 'Fictional usage privacy test' },
        });
        await db.$transaction(
          async (tx) => {
            await lockActiveClient(tx, client.id, registration.psychologistId);
            await eraseClientPhi(tx, {
              clientId: client.id,
              erasureRequestId: erasure.id,
              psychologistId: registration.psychologistId,
              now: new Date(),
            });
          },
          { timeout: 20_000 },
        );
        expect(await db.sessionUsageConnection.count({ where: { clientId: client.id } })).toBe(0);
        expect(await db.session.count({ where: { id: session.id } })).toBe(1);
        await expect(
          db.$transaction((tx) =>
            loadSessionUsageDataExport(tx, client.id, registration.psychologistId),
          ),
        ).rejects.toThrow('Client not found or has been erased');
        await expect(
          db.sessionUsageConnection.create({
            data: { ...registration, connectionId: randomUUID() },
          }),
        ).rejects.toThrow();
      } finally {
        vi.unstubAllEnvs();
      }
    });
    it.each(['write-first', 'erasure-first'] as const)(
      'serializes usage registration against terminal erasure with real Client locks (%s)',
      async (ordering) => {
        const { registration, client } = await fixture();
        let releaseFirst!: () => void;
        const released = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        let reportLocked!: () => void;
        const locked = new Promise<void>((resolve) => {
          reportLocked = resolve;
        });
        const write = async (first: boolean) =>
          db.$transaction(
            async (tx) => {
              await lockActiveClient(tx, client.id, registration.psychologistId);
              if (first) {
                reportLocked();
                await released;
              }
              await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${registration.sessionId} FOR UPDATE`;
              await tx.sessionUsageConnection.create({ data: registration });
            },
            { timeout: 10_000 },
          );
        const erase = async (first: boolean) =>
          db.$transaction(
            async (tx) => {
              await lockActiveClient(tx, client.id, registration.psychologistId);
              if (first) {
                reportLocked();
                await released;
              }
              await tx.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
              await tx.sessionUsageConnection.deleteMany({ where: { clientId: client.id } });
            },
            { timeout: 10_000 },
          );
        const first = ordering === 'write-first' ? write(true) : erase(true);
        await locked;
        const second = (ordering === 'write-first' ? erase(false) : write(false)).then(
          () => null,
          (error: unknown) => error,
        );
        releaseFirst();
        await first;
        const secondResult = await second;
        if (ordering === 'erasure-first') expect(secondResult).toBeInstanceOf(Error);
        else expect(secondResult).toBeNull();
        expect(await db.sessionUsageConnection.count({ where: { clientId: client.id } })).toBe(0);
      },
    );
  },
);
