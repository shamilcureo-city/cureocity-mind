import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MindManualNoteFieldsSchema } from '@cureocity/contracts';
import { INSTRUMENTS } from '@cureocity/clinical';

// Actual routes, Prisma, audit, constraints and locks; identity and tenant KMS
// are fixtures. This tests persistence, not Firebase, real encryption or a model.
const identity = vi.hoisted(() => ({ id: '' }));
vi.mock('./auth-server', () => {
  const auth = async () => ({
    ok: true,
    value: {
      psychologistId: identity.id,
      user: {
        vertical: 'THERAPIST',
        capabilities: [
          'BEHAVIORAL_HEALTH_DOCUMENTATION',
          'MEASUREMENT_BASED_CARE',
          'THERAPY_WORKFLOWS',
        ],
      },
    },
  });
  return { requirePsychologistId: auth, requireCapability: auth };
});
vi.mock('./tenant-crypto', () => ({
  encryptForTenant: async (owner: string, value: string) =>
    `fixture:${owner}:${Buffer.from(value).toString('base64')}`,
  decryptForTenant: async (owner: string, value: string) =>
    value.startsWith(`fixture:${owner}:`)
      ? Buffer.from(value.slice(`fixture:${owner}:`.length), 'base64').toString()
      : null,
}));
vi.mock('@cureocity/observability/metrics', () => ({ recordAuditWrite: vi.fn() }));
import {
  POST as manualPost,
  GET as manualGet,
} from '../app/api/v1/sessions/[id]/manual-note/route';
import { POST as instrumentPost } from '../app/api/v1/clients/[id]/instruments/[instrumentKey]/draft/route';
import { POST as carePost } from '../app/api/v1/clients/[id]/care-record/route';
import { loadMindCareDataExport } from './mind-care-data-export';
import { eraseClientPhi } from './dpdp-erasure';
import { lockActiveClient } from './phi-write-lock';

function isolatedUrl(raw: string | undefined) {
  if (!raw) throw new Error('Explicit isolated test database required');
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
it('refuses production or implicit database targets', () => {
  expect(() => isolatedUrl(undefined)).toThrow();
  expect(() => isolatedUrl('postgresql://user:password@production.invalid/db')).toThrow();
  expect(() =>
    isolatedUrl('postgresql://test:test@127.0.0.1:55439/cureocity_mind_test?host=remote'),
  ).toThrow();
});
const request = (path: string, body: unknown) =>
  new NextRequest(`https://mind.test/api/v1/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const careBody = {
  version: 'V1',
  agreement: {
    scope: 'Fictional counselling agreement',
    confidentialityAndLimits: '',
    practicalArrangements: '',
    contactAndCrisisArrangements: '',
    clientPriorities: '',
    discussedOn: null,
    reviewOn: null,
  },
  clientVoice: {
    recordedOn: null,
    whatHelped: '',
    whatCouldChange: '',
    everydayChanges: '',
    clinicianReflection: '',
  },
  continuity: {
    stage: 'NOT_PLANNED',
    maintenancePlan: '',
    warningSignsAndResponse: '',
    endingOrReferralPlan: '',
    referralFollowThrough: '',
    reviewOn: null,
  },
};

describe.skipIf(process.env['RUN_MIND_POSTGRES_TESTS'] !== '1')(
  'counselling persistence on isolated PostgreSQL',
  () => {
    let db: PrismaClient;
    beforeAll(async () => {
      const url = isolatedUrl(process.env['MIND_TEST_DATABASE_URL']);
      if (globalThis.__cureocityPrisma) throw new Error('Refusing existing application DB');
      db = new PrismaClient({ datasources: { db: { url } } });
      await db.$connect();
      const [target] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
      expect(target?.name).toBe('cureocity_mind_test');
      globalThis.__cureocityPrisma = db;
    });
    afterAll(async () => {
      if (db) await db.$disconnect();
      if (globalThis.__cureocityPrisma === db) globalThis.__cureocityPrisma = undefined;
    });
    async function fixture() {
      identity.id = randomUUID();
      await db.psychologist.create({
        data: {
          id: identity.id,
          firebaseUid: `fictional-${identity.id}`,
          email: `${identity.id}@test.invalid`,
          fullName: 'Fictional counselling tester',
          phone: `fixture-${identity.id}`,
          rciNumber: `fixture-${identity.id}`,
          status: 'ACTIVE',
          vertical: 'THERAPIST',
        },
      });
      const client = await db.client.create({
        data: { psychologistId: identity.id, isDemo: true },
      });
      const session = await db.session.create({
        data: {
          clientId: client.id,
          psychologistId: identity.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          kind: 'TREATMENT',
          mindPurpose: 'COUNSELLING',
          mindDocumentationMode: 'MANUAL',
        },
      });
      return { client, session };
    }
    const manual = (id: string, body: unknown) =>
      manualPost(request(`sessions/${id}/manual-note`, body), { params: Promise.resolve({ id }) });
    const instrument = (id: string, body: unknown) =>
      instrumentPost(request(`clients/${id}/instruments/PHQ9/draft`, body), {
        params: Promise.resolve({ id, instrumentKey: 'PHQ9' }),
      });
    const care = (id: string, body: unknown) =>
      carePost(request(`clients/${id}/care-record`, body), { params: Promise.resolve({ id }) });

    it('enforces care-record tenant and erased-client ownership in PostgreSQL itself', async () => {
      const first = await fixture();
      const other = await fixture();
      const data = {
        clientId: first.client.id,
        psychologistId: other.client.psychologistId,
        version: 1,
        operationId: randomUUID(),
        bodyEncrypted: 'fixture-ciphertext',
      };
      await expect(db.clientMindCareRecord.create({ data })).rejects.toThrow();
      await db.client.update({ where: { id: first.client.id }, data: { deletedAt: new Date() } });
      await expect(
        db.clientMindCareRecord.create({
          data: { ...data, psychologistId: first.client.psychologistId },
        }),
      ).rejects.toThrow();
      expect(await db.clientMindCareRecord.count({ where: { clientId: first.client.id } })).toBe(0);
    });

    it('starts without consent/audio, recovers an encrypted draft and completes without model artifacts', async () => {
      const { client, session } = await fixture();
      expect(
        (
          await manual(session.id, {
            operation: 'start',
            expectedUpdatedAt: session.updatedAt.toISOString(),
            mindPurpose: 'COUNSELLING',
          })
        ).status,
      ).toBe(200);
      const fields = MindManualNoteFieldsSchema.parse({
        subjective: 'Fictional concern',
        objective: 'Fictional observation',
        assessment: 'Clinician understanding under review',
        plan: 'Agreed next meeting',
        riskSeverity: 'none',
        riskDetails: 'Fictional explicit safety assessment',
      });
      const save = {
        operation: 'save',
        expectedRevision: 0,
        expectedNoteUpdatedAt: null,
        mutationId: randomUUID(),
        fields,
      };
      expect((await manual(session.id, save)).status).toBe(200);
      expect((await manual(session.id, save)).status).toBe(200);
      const row = await db.mindManualNoteDraft.findUniqueOrThrow({
        where: { sessionId: session.id },
      });
      expect(row.revision).toBe(1);
      expect(row.encryptedFields).not.toContain('Fictional concern');
      const read = await manualGet(
        new NextRequest(`https://mind.test/api/v1/sessions/${session.id}/manual-note`),
        { params: Promise.resolve({ id: session.id }) },
      );
      expect((await read.json()).fields.subjective).toBe('Fictional concern');
      expect(
        (
          await manual(session.id, {
            operation: 'complete',
            expectedRevision: 1,
            expectedNoteUpdatedAt: null,
            mutationId: randomUUID(),
            fields,
          })
        ).status,
      ).toBe(200);
      const final = await db.session.findUniqueOrThrow({
        where: { id: session.id },
        include: { noteDraft: true, mindManualNoteDraft: true },
      });
      expect(final.status).toBe('COMPLETED');
      expect(final.mindManualNoteDraft?.encryptedFields).toBeNull();
      expect(final.noteDraft?.speakerSegments).toBeNull();
      expect(final.noteDraft?.transcriptEncrypted).toBeNull();
      expect(await db.geminiCallLog.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await db.audioChunk.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await db.consent.count({ where: { clientId: client.id } })).toBe(0);
    });
    it('serializes concurrent questionnaire tabs and permits exactly one scored submission on retries', async () => {
      const { client } = await fixture();
      const responses = Object.fromEntries(INSTRUMENTS.PHQ9.items.map((item) => [item.id, 0]));
      const saved = await Promise.all(
        [0, 1].map(() =>
          instrument(client.id, {
            operation: 'SAVE',
            expectedRevision: 0,
            mutationId: randomUUID(),
            responses,
          }),
        ),
      );
      expect(saved.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await db.instrumentResponse.count({ where: { clientId: client.id } })).toBe(0);
      const submit = { operation: 'SUBMIT', expectedRevision: 1, mutationId: randomUUID() };
      const submitted = await Promise.all([
        instrument(client.id, submit),
        instrument(client.id, submit),
      ]);
      expect(submitted.map((r) => r.status)).toEqual([200, 200]);
      const bodies = await Promise.all(submitted.map((r) => r.json()));
      expect(bodies[0].submittedResponseId).toBe(bodies[1].submittedResponseId);
      expect(await db.instrumentResponse.count({ where: { clientId: client.id } })).toBe(1);
      const row = await db.mindInstrumentDraft.findUniqueOrThrow({
        where: { clientId_instrumentKey: { clientId: client.id, instrumentKey: 'PHQ9' } },
      });
      expect(row.answersEncrypted).toBeNull();
      expect(row.status).toBe('SUBMITTED');
      expect(
        (
          await instrument(client.id, {
            operation: 'SAVE',
            expectedRevision: 1,
            mutationId: randomUUID(),
            responses,
          })
        ).status,
      ).toBe(409);
    });
    it('versions care-record races, replays the same receipt and never grants recording consent', async () => {
      const { client } = await fixture();
      const first = { operationId: randomUUID(), expectedVersion: 0, body: careBody };
      const created = await Promise.all([care(client.id, first), care(client.id, first)]);
      expect(created.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(await db.clientMindCareRecord.count({ where: { clientId: client.id } })).toBe(1);
      const races = await Promise.all(
        [0, 1].map(() =>
          care(client.id, { operationId: randomUUID(), expectedVersion: 1, body: careBody }),
        ),
      );
      expect(races.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.consent.count({ where: { clientId: client.id } })).toBe(0);
      expect((await db.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe(
        'ACTIVE',
      );
    });
    it('exports drafts and versions then erases the new clinical rows without resurrecting them', async () => {
      const { client, session } = await fixture();
      await manual(session.id, {
        operation: 'start',
        expectedUpdatedAt: session.updatedAt.toISOString(),
      });
      await manual(session.id, {
        operation: 'save',
        expectedRevision: 0,
        expectedNoteUpdatedAt: null,
        mutationId: randomUUID(),
        fields: { subjective: 'Fictional unfinished note' },
      });
      await instrument(client.id, {
        operation: 'SAVE',
        expectedRevision: 0,
        mutationId: randomUUID(),
        responses: {},
      });
      await care(client.id, { expectedVersion: 0, operationId: randomUUID(), body: careBody });
      const exported = await db.$transaction((tx) =>
        loadMindCareDataExport(
          tx,
          client.id,
          identity.id,
          new Set([
            'BEHAVIORAL_HEALTH_DOCUMENTATION',
            'MEASUREMENT_BASED_CARE',
            'THERAPY_WORKFLOWS',
          ]),
        ),
      );
      expect(exported.mindManualNoteDrafts?.[0]?.fields?.subjective).toBe(
        'Fictional unfinished note',
      );
      expect(exported.mindCareRecords).toHaveLength(1);
      expect(exported.mindInstrumentDrafts).toHaveLength(1);
      const erasure = await db.clientErasureRequest.create({
        data: { clientId: client.id, reason: 'Fictional erasure test' },
      });
      await db.$transaction(
        async (tx) => {
          await lockActiveClient(tx, client.id, identity.id);
          await eraseClientPhi(tx, {
            clientId: client.id,
            erasureRequestId: erasure.id,
            psychologistId: identity.id,
            now: new Date(),
          });
        },
        { timeout: 20_000 },
      );
      expect(await db.mindManualNoteDraft.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await db.mindInstrumentDraft.count({ where: { clientId: client.id } })).toBe(0);
      expect(await db.clientMindCareRecord.count({ where: { clientId: client.id } })).toBe(0);
      expect(
        (await care(client.id, { expectedVersion: 0, operationId: randomUUID(), body: careBody }))
          .status,
      ).toBe(404);
      expect(
        (
          await instrument(client.id, {
            operation: 'SAVE',
            expectedRevision: 0,
            mutationId: randomUUID(),
            responses: {},
          })
        ).status,
      ).toBe(404);
    });
  },
);
