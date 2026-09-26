import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Actual PostgreSQL and lifecycle locks, with fictional identity and envelope fixtures.
// This does not validate Firebase, real KMS or external AI providers.
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
  createScribeRecord,
  deleteScribeRecord,
  getScribeRecord,
  updateScribeRecord,
  type ScribeRecordKind,
} from './scribe-workspace-store';
import { lockActiveClient } from './phi-write-lock';
import {
  createScribeDoctorTemplate,
  readScribeDoctorTemplate,
  scribeDoctorTemplateScope,
} from './scribe-doctor-template-store';
import { ScribeConsultationDocumentPacketBodySchema } from './scribe-consultation-documents';

const requiredMigrations = [
  '20260928000000_scribe_doctor_workflow',
  '20260929000000_scribe_teleconsult',
  '20260930000000_scribe_coding',
  '20261001000000_scribe_consultation_documents',
  '20261002000000_scribe_doctor_templates',
] as const;
const runtimeRole = 'scribe_test_runtime';

function isolatedUrl(raw: string | undefined): string {
  if (!raw) throw new Error('Explicit disposable Scribe test URL required');
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55440' ||
    url.pathname !== '/cureocity_scribe_test' ||
    decodeURIComponent(url.username) !== runtimeRole ||
    url.search ||
    url.hash
  ) {
    throw new Error('Refusing a non-isolated database');
  }
  return url.toString();
}
it('never uses an implicit, production, or parameter-overridden database', () => {
  expect(() => isolatedUrl(undefined)).toThrow();
  expect(() => isolatedUrl('postgresql://user:pass@production.invalid/data')).toThrow();
  expect(() =>
    isolatedUrl('postgresql://x:x@127.0.0.1:55440/cureocity_scribe_test?host=elsewhere'),
  ).toThrow();
  expect(() =>
    isolatedUrl('postgresql://migration_owner:fixture@127.0.0.1:55440/cureocity_scribe_test'),
  ).toThrow();
  expect(
    isolatedUrl('postgresql://scribe_test_runtime:fixture@127.0.0.1:55440/cureocity_scribe_test'),
  ).toContain('/cureocity_scribe_test');
});

type RuntimeProof = {
  role: string;
  database: string;
  serverAddress: string | null;
  serverPort: number | null;
  superuser: boolean;
  bypassRls: boolean;
  createRole: boolean;
  createDatabase: boolean;
  replication: boolean;
  ownerMembership: boolean;
  schemaCreate: boolean;
  schemaReady: boolean;
  triggersReady: boolean;
  indexesReady: boolean;
  privilegesReady: boolean;
  migrationsReady: boolean;
};
function assertIsolatedRuntimeProof(proof: RuntimeProof | undefined): void {
  const forbidden = [
    'superuser',
    'bypassRls',
    'createRole',
    'createDatabase',
    'replication',
    'ownerMembership',
    'schemaCreate',
  ] as const;
  const required = [
    'schemaReady',
    'triggersReady',
    'indexesReady',
    'privilegesReady',
    'migrationsReady',
  ] as const;
  if (
    !proof ||
    proof.role !== runtimeRole ||
    proof.database !== 'cureocity_scribe_test' ||
    proof.serverAddress !== '127.0.0.1' ||
    proof.serverPort !== 55440 ||
    forbidden.some((key) => proof[key] !== false) ||
    required.some((key) => proof[key] !== true)
  ) {
    throw new Error(
      'Refusing fixture writes: isolated runtime role and complete Scribe schema were not verified',
    );
  }
}
const safeProof: RuntimeProof = {
  role: runtimeRole,
  database: 'cureocity_scribe_test',
  serverAddress: '127.0.0.1',
  serverPort: 55440,
  superuser: false,
  bypassRls: false,
  createRole: false,
  createDatabase: false,
  replication: false,
  ownerMembership: false,
  schemaCreate: false,
  schemaReady: true,
  triggersReady: true,
  indexesReady: true,
  privilegesReady: true,
  migrationsReady: true,
};
describe('Scribe PostgreSQL preflight validation (pure, no connection)', () => {
  it('accepts only the dedicated runtime role with complete positive schema proof', () => {
    expect(() => assertIsolatedRuntimeProof(safeProof)).not.toThrow();
    expect(() => assertIsolatedRuntimeProof(undefined)).toThrow('Refusing fixture writes');
  });
  it.each([
    { role: 'migration_owner' },
    { database: 'production' },
    { serverAddress: '10.0.0.1' },
    { serverPort: 5432 },
    { superuser: true },
    { bypassRls: true },
    { createRole: true },
    { createDatabase: true },
    { replication: true },
    { ownerMembership: true },
    { schemaCreate: true },
    { schemaReady: false },
    { triggersReady: false },
    { indexesReady: false },
    { privilegesReady: false },
    { migrationsReady: false },
    { schemaReady: undefined },
  ])('fails closed before fixture writes for unsafe or incomplete proof %#', (override) => {
    expect(() => assertIsolatedRuntimeProof({ ...safeProof, ...override } as RuntimeProof)).toThrow(
      'Refusing fixture writes',
    );
  });
});

describe.skipIf(process.env['RUN_SCRIBE_POSTGRES_TESTS'] !== '1')(
  'Scribe workspace on isolated PostgreSQL',
  () => {
    let db: PrismaClient;
    beforeAll(async () => {
      const url = isolatedUrl(process.env['SCRIBE_TEST_DATABASE_URL']);
      if (globalThis.__cureocityPrisma)
        throw new Error('Refusing an existing application DB client');
      db = new PrismaClient({ datasources: { db: { url } } });
      await db.$connect();
      // Read-only preflight precedes global application-client injection and every fixture.
      // Missing tables/privileges fail the query; unknown or incomplete proof also fails closed.
      const proof = await db.$queryRaw<RuntimeProof[]>`
        SELECT current_user::text AS "role", current_database()::text AS "database",
          host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort",
          r.rolsuper AS "superuser", r.rolbypassrls AS "bypassRls",
          r.rolcreaterole AS "createRole", r.rolcreatedb AS "createDatabase", r.rolreplication AS "replication",
          pg_has_role(current_user, pg_get_userbyid(c.relowner), 'MEMBER') AS "ownerMembership",
          has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate",
          (c.relkind = 'r' AND (
            SELECT COUNT(*) = 4 FROM pg_constraint con
            WHERE con.conrelid = c.oid AND con.convalidated AND con.contype = 'c'
              AND con.conname IN ('scribe_workspace_positive_revision', 'scribe_workspace_kind',
                'scribe_workspace_scope', 'scribe_workspace_encrypted_body')
          ) AND EXISTS (
            SELECT 1 FROM pg_constraint con WHERE con.conrelid = c.oid
              AND con.conname = 'scribe_workspace_kind' AND con.convalidated
              AND pg_get_constraintdef(con.oid) LIKE '%template%'
              AND pg_get_constraintdef(con.oid) LIKE '%documents%'
              AND pg_get_constraintdef(con.oid) LIKE '%coding%'
              AND pg_get_constraintdef(con.oid) LIKE '%teleconsult%'
          )) AS "schemaReady",
          ((SELECT COUNT(*) = 3 FROM pg_trigger t
            WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND (
              (t.tgrelid = c.oid AND t.tgname = 'scribe_workspace_record_guard') OR
              (t.tgrelid = 'public.sessions'::regclass AND t.tgname = 'scribe_workspace_session_guard') OR
              (t.tgrelid = 'public.clients'::regclass AND t.tgname = 'scribe_workspace_client_guard')
            ))) AS "triggersReady",
          ((SELECT COUNT(*) = 2 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
            WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL
              AND ((idx.relname = 'scribe_workspace_one_teleconsult_per_session'
                AND pg_get_expr(i.indpred, i.indrelid) LIKE '%teleconsult%') OR
                (idx.relname = 'scribe_workspace_one_coding_per_session'
                AND pg_get_expr(i.indpred, i.indrelid) LIKE '%coding%')))) AS "indexesReady",
          (has_table_privilege(current_user, c.oid, 'SELECT')
            AND has_table_privilege(current_user, c.oid, 'INSERT')
            AND has_table_privilege(current_user, c.oid, 'UPDATE')
            AND has_table_privilege(current_user, c.oid, 'DELETE')
            AND has_table_privilege(current_user, 'public.audit_logs', 'SELECT')
            AND has_table_privilege(current_user, 'public.audit_logs', 'INSERT')) AS "privilegesReady",
          ((SELECT COUNT(DISTINCT migration_name) = ${requiredMigrations.length}
            FROM public._prisma_migrations WHERE migration_name IN (${Prisma.join(requiredMigrations)})
              AND finished_at IS NOT NULL AND rolled_back_at IS NULL)) AS "migrationsReady"
        FROM pg_roles r JOIN pg_class c ON c.oid = to_regclass('public.scribe_workspace_records')
        WHERE r.rolname = current_user
      `;
      if (proof.length !== 1)
        throw new Error('Refusing fixture writes: missing isolated runtime proof');
      assertIsolatedRuntimeProof(proof[0]);
      globalThis.__cureocityPrisma = db;
    });
    afterAll(async () => {
      if (db) await db.$disconnect();
      globalThis.__cureocityPrisma = undefined;
    });
    async function fixture() {
      const id = `scribe-test-${randomUUID()}`;
      const doctor = await db.psychologist.create({
        data: {
          id,
          firebaseUid: id,
          email: `${id}@test.invalid`,
          fullName: 'Fictional doctor',
          phone: id,
          rciNumber: id,
          status: 'ACTIVE',
          vertical: 'DOCTOR',
        },
      });
      const client = await db.client.create({ data: { psychologistId: doctor.id, isDemo: true } });
      const session = await db.session.create({
        data: {
          clientId: client.id,
          psychologistId: doctor.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
        },
      });
      return {
        doctor,
        client,
        session,
        scope: {
          psychologistId: doctor.id,
          clientId: client.id,
          sessionId: session.id,
          kind: 'task' as const,
        },
      };
    }
    const schema = z.object({ text: z.string() });

    const kindScopes: Array<[ScribeRecordKind, 'personal' | 'patient' | 'encounter']> = [
      ['shortcut', 'personal'],
      ['note_style', 'personal'],
      ['template', 'personal'],
      ['intake', 'patient'],
      ['task', 'patient'],
      ['report', 'patient'],
      ['instructions', 'patient'],
      ['teleconsult', 'encounter'],
      ['coding', 'encounter'],
      ['documents', 'encounter'],
    ];
    it.each(kindScopes)(
      'enforces the migrated %s scope in PostgreSQL itself',
      async (kind, category) => {
        const { doctor, client, session } = await fixture();
        const data = {
          psychologistId: doctor.id,
          kind,
          bodyEncrypted: 'opaque-fictional-storage-fixture',
          clientId: category === 'personal' ? null : client.id,
          sessionId: category === 'encounter' ? session.id : null,
        };
        const stored = await db.scribeWorkspaceRecord.create({ data });
        expect(stored).toMatchObject({ kind, clientId: data.clientId, sessionId: data.sessionId });
        const invalid =
          category === 'personal'
            ? { ...data, clientId: client.id, sessionId: session.id }
            : category === 'encounter'
              ? { ...data, sessionId: null }
              : { ...data, clientId: null, sessionId: null };
        await expect(db.scribeWorkspaceRecord.create({ data: invalid })).rejects.toThrow();
        expect(
          await db.scribeWorkspaceRecord.count({ where: { psychologistId: doctor.id, kind } }),
        ).toBe(1);
      },
    );

    it('enforces one teleconsult and one coding worksheet per encounter while allowing multiple document packets', async () => {
      const { scope } = await fixture();
      const data = { ...scope, bodyEncrypted: 'opaque-fictional-storage-fixture' };
      for (const kind of ['teleconsult', 'coding'] as const) {
        await db.scribeWorkspaceRecord.create({ data: { ...data, kind } });
        await expect(
          db.scribeWorkspaceRecord.create({ data: { ...data, kind } }),
        ).rejects.toMatchObject({ code: 'P2002' });
      }
      await db.scribeWorkspaceRecord.create({ data: { ...data, kind: 'documents' } });
      await db.scribeWorkspaceRecord.create({ data: { ...data, kind: 'documents' } });
      expect(await db.scribeWorkspaceRecord.count({ where: { sessionId: scope.sessionId } })).toBe(
        4,
      );
    });

    it('persists template create/edit/delete and consumes the original operation in the real audit transaction', async () => {
      const { doctor } = await fixture();
      const input = {
        operationId: randomUUID(),
        containsNoPatientData: true,
        template: {
          kind: 'document_skeleton',
          name: 'Fictional referral headings',
          documentType: 'referral',
          prompts: ['recipient', 'referral_reason'],
        },
      } satisfies Parameters<typeof createScribeDoctorTemplate>[1];
      const first = await createScribeDoctorTemplate(doctor.id, input);
      expect(first.created).toBe(true);
      expect(first.record).toMatchObject({ revision: 1, clientId: null, sessionId: null });
      const changed = await updateScribeRecord(
        scribeDoctorTemplateScope(doctor.id),
        first.record.id,
        1,
        {
          ...first.record.body,
          template: { ...input.template, name: 'Updated private headings' },
        },
      );
      expect(changed.revision).toBe(2);
      const replay = await createScribeDoctorTemplate(doctor.id, input);
      expect(replay.created).toBe(false);
      expect(replay.record.body.template.name).toBe('Updated private headings');
      expect(replay.record.body.createHash).toBe(first.record.body.createHash);
      await deleteScribeRecord(scribeDoctorTemplateScope(doctor.id), first.record.id, 2);
      const deletion = await db.auditLog.findFirstOrThrow({
        where: {
          actorPsychologistId: doctor.id,
          action: 'SCRIBE_WORKSPACE_UPDATED',
          targetId: first.record.id,
          metadata: { path: ['operation'], equals: 'delete' },
        },
      });
      expect(deletion.metadata).toEqual({ kind: 'template', operation: 'delete', revision: 2 });
      await expect(createScribeDoctorTemplate(doctor.id, input)).rejects.toMatchObject({
        status: 409,
      });
      await expect(readScribeDoctorTemplate(doctor.id, first.record.id)).rejects.toMatchObject({
        status: 404,
      });
      expect(await db.scribeWorkspaceRecord.count({ where: { id: first.record.id } })).toBe(0);
      expect(
        (await createScribeDoctorTemplate(doctor.id, { ...input, operationId: randomUUID() }))
          .created,
      ).toBe(true);
    });

    it('serializes concurrent template retries to one encrypted record and one create audit', async () => {
      const { doctor } = await fixture();
      const input = {
        operationId: randomUUID(),
        containsNoPatientData: true,
        template: {
          kind: 'document_skeleton',
          name: 'Private summary headings',
          documentType: 'patient_summary',
          prompts: ['patient_questions'],
        },
      } satisfies Parameters<typeof createScribeDoctorTemplate>[1];
      const results = await Promise.all([
        createScribeDoctorTemplate(doctor.id, input),
        createScribeDoctorTemplate(doctor.id, input),
      ]);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(results[0]!.record.id).toBe(results[1]!.record.id);
      expect(
        await db.scribeWorkspaceRecord.count({
          where: { psychologistId: doctor.id, kind: 'template' },
        }),
      ).toBe(1);
      expect(
        await db.auditLog.count({
          where: {
            actorPsychologistId: doctor.id,
            targetId: results[0]!.record.id,
            action: 'SCRIBE_WORKSPACE_UPDATED',
          },
        }),
      ).toBe(1);
    });

    it('preserves document packet source fields with one CAS winner and erases patient copies, not personal templates', async () => {
      const { doctor, client, scope } = await fixture();
      const documentScope = { ...scope, kind: 'documents' as const };
      // This is a storage fixture, not evidence of a generated/signed clinical document.
      const body = ScribeConsultationDocumentPacketBodySchema.parse({
        version: 1,
        operationId: randomUUID(),
        sourceHash: 'a'.repeat(64),
        noteId: 'fictional-source-note',
        signedAt: '2026-09-26T12:00:00Z',
        requestHash: 'b'.repeat(64),
        documents: [
          {
            id: 'referral',
            type: 'referral',
            sourceSections: [{ label: 'Fictional source', text: 'Fictional excerpt' }],
            additions: '',
            status: 'draft',
            reviewedAt: null,
            reviewedBy: null,
          },
        ],
      });
      const record = await createScribeRecord(documentScope, body);
      const personal = await createScribeDoctorTemplate(doctor.id, {
        operationId: randomUUID(),
        containsNoPatientData: true,
        template: {
          kind: 'document_skeleton',
          name: 'Private referral headings',
          documentType: 'referral',
          prompts: ['recipient'],
        },
      });
      const results = await Promise.allSettled(
        ['First window', 'Second window'].map((additions) =>
          updateScribeRecord(documentScope, record.id, 1, {
            ...body,
            documents: [{ ...body.documents[0]!, additions }],
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const current = await getScribeRecord(
        documentScope,
        record.id,
        ScribeConsultationDocumentPacketBodySchema,
      );
      expect(current?.revision).toBe(2);
      expect(current?.body.sourceHash).toBe(body.sourceHash);
      expect(current?.body.documents[0]?.sourceSections).toEqual(body.documents[0]?.sourceSections);
      await db.$transaction(async (tx) => {
        await lockActiveClient(tx, client.id, doctor.id);
        await tx.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
        await tx.scribeWorkspaceRecord.deleteMany({ where: { clientId: client.id } });
      });
      expect(
        await getScribeRecord(documentScope, record.id, ScribeConsultationDocumentPacketBodySchema),
      ).toBeNull();
      expect(await db.scribeWorkspaceRecord.count({ where: { clientId: client.id } })).toBe(0);
      expect(
        (await readScribeDoctorTemplate(doctor.id, personal.record.id)).body.template.name,
      ).toBe('Private referral headings');
      await expect(createScribeRecord(documentScope, body)).rejects.toThrow();
    });

    it('persists ciphertext and round-trips only the correct tenant', async () => {
      const first = await fixture();
      const other = await fixture();
      const record = await createScribeRecord(first.scope, { text: 'Fictional pending result' });
      const raw = await db.scribeWorkspaceRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(raw.bodyEncrypted).not.toContain('Fictional pending result');
      expect((await getScribeRecord(first.scope, record.id, schema))?.body.text).toBe(
        'Fictional pending result',
      );
      expect(await getScribeRecord(other.scope, record.id, schema)).toBeNull();
    });

    it('rejects cross-tenant, patient-free and cross-encounter records in PostgreSQL itself', async () => {
      const first = await fixture();
      const other = await fixture();
      const data = { ...first.scope, bodyEncrypted: 'opaque-test-envelope' };
      await expect(
        db.scribeWorkspaceRecord.create({ data: { ...data, psychologistId: other.doctor.id } }),
      ).rejects.toThrow();
      await expect(
        db.scribeWorkspaceRecord.create({ data: { ...data, clientId: null, sessionId: null } }),
      ).rejects.toThrow();
      await expect(
        db.scribeWorkspaceRecord.create({ data: { ...data, sessionId: other.session.id } }),
      ).rejects.toThrow();
    });

    it('permits only one winner for concurrent edits of the same revision', async () => {
      const { scope } = await fixture();
      const record = await createScribeRecord(scope, { text: 'Original' });
      const results = await Promise.allSettled([
        updateScribeRecord(scope, record.id, record.revision, { text: 'First window' }),
        updateScribeRecord(scope, record.id, record.revision, { text: 'Second window' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await getScribeRecord(scope, record.id, schema))?.revision).toBe(2);
    });

    it('does not permit moving clinical records or their parent visit to another patient', async () => {
      const first = await fixture();
      const otherClient = await db.client.create({ data: { psychologistId: first.doctor.id } });
      const record = await createScribeRecord(first.scope, { text: 'Fictional' });
      await expect(
        db.scribeWorkspaceRecord.update({
          where: { id: record.id },
          data: { clientId: otherClient.id, revision: 2 },
        }),
      ).rejects.toThrow();
      await expect(
        db.session.update({ where: { id: first.session.id }, data: { clientId: otherClient.id } }),
      ).rejects.toThrow();
      await expect(
        db.scribeWorkspaceRecord.update({ where: { id: record.id }, data: { revision: 7 } }),
      ).rejects.toThrow();
    });

    it('stops reads and writes after terminal patient erasure', async () => {
      const { scope, client } = await fixture();
      const record = await createScribeRecord(scope, { text: 'Fictional report source' });
      await db.$transaction(async (tx) => {
        await lockActiveClient(tx, client.id, scope.psychologistId);
        await tx.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
        await tx.scribeWorkspaceRecord.deleteMany({ where: { clientId: client.id } });
      });
      expect(await getScribeRecord(scope, record.id, schema)).toBeNull();
      await expect(createScribeRecord(scope, { text: 'Delayed network result' })).rejects.toThrow();
      expect(await db.scribeWorkspaceRecord.count({ where: { clientId: client.id } })).toBe(0);
    });

    it('serializes an in-flight writer before erasure so its content is removed too', async () => {
      const { scope, client } = await fixture();
      let reached!: () => void;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const continueWrite = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writer = createScribeRecord(
        {
          ...scope,
          guard: async () => {
            reached();
            await continueWrite;
          },
        },
        { text: 'Queued fictional document' },
      );
      await held;
      const erase = db.$transaction(async (tx) => {
        await lockActiveClient(tx, client.id, scope.psychologistId);
        await tx.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
        await tx.scribeWorkspaceRecord.deleteMany({ where: { clientId: client.id } });
      });
      release();
      await Promise.all([writer, erase]);
      expect(await db.scribeWorkspaceRecord.count({ where: { clientId: client.id } })).toBe(0);
    });

    it('rejects token-style writes when the granting doctor is suspended', async () => {
      const { scope, doctor } = await fixture();
      await db.psychologist.update({ where: { id: doctor.id }, data: { status: 'SUSPENDED' } });
      await expect(
        createScribeRecord(
          { ...scope, kind: 'intake', actorType: 'SYSTEM' },
          { text: 'Submission' },
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  },
);
