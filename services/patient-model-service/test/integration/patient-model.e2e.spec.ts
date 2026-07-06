/**
 * Integration test against a real Postgres.
 *
 * Skipped unless RUN_INTEGRATION_TESTS=1. In CI, the workflow sets:
 *   DATABASE_URL=postgresql://cureocity:cureocity@localhost:5432/cureocity_mind_test
 *   AUTH_BYPASS=true
 *   RUN_INTEGRATION_TESTS=1
 *
 * Locally: `pnpm infra:up && DATABASE_URL=... AUTH_BYPASS=true RUN_INTEGRATION_TESTS=1 pnpm nx test patient-model-service`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

const SKIP = process.env['RUN_INTEGRATION_TESTS'] !== '1';

const DEV_FIREBASE_UID = 'dev-firebase-uid-priya';

/**
 * CI runs every project's tests in parallel against ONE shared Postgres,
 * and both this suite and the scribe e2e wipe the same tables in
 * beforeEach — so one suite's wipe landed mid-pipeline in the other (the
 * "expected 404 to be 201" flake, failing at a different step each run).
 * A session-scoped advisory lock serialises the DB-destructive suites:
 * whichever starts second waits. The lock client pins a single pooled
 * connection so acquire and auto-release-on-disconnect happen on the same
 * Postgres session. Keep the key in sync with scribe-e2e.spec.ts.
 */
const E2E_DB_LOCK_KEY = 727272;

describe.skipIf(SKIP)('patient-model-service (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dbLock: PrismaClient | null = null;

  beforeAll(async () => {
    const base = process.env['DATABASE_URL'];
    if (base) {
      const url = base.includes('?') ? `${base}&connection_limit=1` : `${base}?connection_limit=1`;
      dbLock = new PrismaClient({ datasources: { db: { url } } });
      // ::text cast — pg_advisory_lock() returns void, which Prisma can't deserialize.
      await dbLock.$queryRaw`SELECT pg_advisory_lock(${E2E_DB_LOCK_KEY})::text`;
    }

    process.env['AUTH_BYPASS'] = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    // Session end releases the advisory lock.
    await dbLock?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.consent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.client.deleteMany();
    await prisma.psychologist.deleteMany();
  });

  it('full happy path: register psychologist → create client → list → briefing', async () => {
    const server = app.getHttpServer();

    // 1. Register the psychologist via POST /psychologists
    const registerRes = await request(server).post('/api/v1/psychologists').send({
      fullName: 'Dr. Priya Menon',
      email: 'priya.menon@example.in',
      phone: '+919876543210',
      rciNumber: 'A12345',
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.firebaseUid).toBe(DEV_FIREBASE_UID);

    // 2. Create a client with two consents
    const createClientRes = await request(server)
      .post('/api/v1/clients')
      .send({
        fullName: 'Arjun Rao',
        contactPhone: '+919812345678',
        contactEmail: 'arjun@example.in',
        dateOfBirth: '1992-03-14',
        presentingConcerns: 'Generalised anxiety',
        preferredModality: 'CBT',
        consents: [
          { scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
          { scope: 'CROSS_BORDER_PROCESSING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
        ],
      });
    expect(createClientRes.status).toBe(201);
    const clientId: string = createClientRes.body.id;
    expect(typeof clientId).toBe('string');
    expect(createClientRes.body.preferredModality).toBe('CBT');

    // 3. List
    const listRes = await request(server).get('/api/v1/clients');
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.nextCursor).toBeNull();

    // 4. Briefing
    const briefingRes = await request(server).get(`/api/v1/clients/${clientId}/briefing`);
    expect(briefingRes.status).toBe(200);
    expect(briefingRes.body.client.id).toBe(clientId);
    expect(briefingRes.body.consents).toHaveLength(2);
    expect(briefingRes.body.recentSessions).toEqual([]);
    expect(briefingRes.body.lastNote).toBeNull();

    // 5. PATCH — partial update + audit
    const patchRes = await request(server)
      .patch(`/api/v1/clients/${clientId}`)
      .send({ fullName: 'Arjun K. Rao' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.fullName).toBe('Arjun K. Rao');

    // 6. Audit log shape:
    //    PSYCHOLOGIST_REGISTERED + CLIENT_CREATED + 2x CONSENT_GRANTED
    //    + CLIENT_BRIEFING_VIEWED + CLIENT_UPDATED = 6
    const actions = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'PSYCHOLOGIST_REGISTERED',
      'CLIENT_CREATED',
      'CONSENT_GRANTED',
      'CONSENT_GRANTED',
      'CLIENT_BRIEFING_VIEWED',
      'CLIENT_UPDATED',
    ]);
  });

  it('returns 404 for a client owned by another psychologist (no cross-tenant leak)', async () => {
    // Bypass user becomes "priya"; register her so she has a psychologistId.
    await request(app.getHttpServer()).post('/api/v1/psychologists').send({
      fullName: 'Dr. Priya Menon',
      email: 'priya.menon@example.in',
      phone: '+919876543210',
      rciNumber: 'A12345',
    });

    // Seed an unrelated psychologist + client directly.
    const otherPsy = await prisma.psychologist.create({
      data: {
        firebaseUid: 'fb-other',
        email: 'other@example.in',
        fullName: 'Dr. Other',
        phone: '+919999999999',
        rciNumber: 'Z99999',
        status: 'ACTIVE',
      },
    });
    const otherClient = await prisma.client.create({
      data: {
        psychologistId: otherPsy.id,
        fullName: 'Stranger',
        contactPhone: '+919000000000',
        status: 'ACTIVE',
      },
    });

    const res = await request(app.getHttpServer()).get(`/api/v1/clients/${otherClient.id}`);
    expect(res.status).toBe(404);

    // Audit log should NOT record the CLIENT_VIEWED — cross-tenant attempts
    // rejected before audit (intentional: we don't surface to actors that
    // the row exists at all).
    const auditCount = await prisma.auditLog.count({ where: { action: 'CLIENT_VIEWED' } });
    expect(auditCount).toBe(0);
  });

  it('returns 403 when an unregistered Firebase user tries to access /clients', async () => {
    // No psychologist row exists → AUTH_BYPASS user has no psychologistId.
    const res = await request(app.getHttpServer()).get('/api/v1/clients');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/POST \/psychologists first/);
  });

  it('rejects invalid Indian phone numbers at the validation layer', async () => {
    await request(app.getHttpServer()).post('/api/v1/psychologists').send({
      fullName: 'Dr. Priya Menon',
      email: 'priya.menon@example.in',
      phone: '+919876543210',
      rciNumber: 'A12345',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/clients')
      .send({
        fullName: 'Bad Phone',
        contactPhone: '+14155552671',
        consents: [{ scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' }],
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/\+91/);
  });
});
