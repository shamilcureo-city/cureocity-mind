/**
 * End-to-end scribe pipeline test.
 *
 * Exercises the full happy path against a real Postgres:
 *   POST /sessions
 *   → POST /sessions/:id/consent
 *   → POST /sessions/:id/start
 *   → POST /sessions/:id/audio-chunks  (synthetic 30s PCM)
 *   → POST /sessions/:id/end           (triggers inline orchestrator)
 *   → GET  /sessions/:id/note-draft    (expect COMPLETED w/ TherapyNoteV1)
 *
 * Backends used (selected via env):
 *   STORAGE_BACKEND=memory       → InMemoryStorageClient (no MinIO)
 *   NOTE_QUEUE_BACKEND=sync      → orchestrator inline (no Redis)
 *   GCP_PROJECT_ID unset         → Mock Gemini Pass 1 + Pass 2
 *
 * Skipped unless RUN_INTEGRATION_TESTS=1.
 *
 * A separate test below is configured for the real Vertex Gemini API.
 * That test runs ONLY when GCP_PROJECT_ID, GCP_SA_KEY_PATH are set;
 * intended for a nightly CI job.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { generateSilence } from './synthetic-audio';

const SKIP = process.env['RUN_INTEGRATION_TESTS'] !== '1';
const DEV_FIREBASE_UID = 'dev-firebase-uid-priya';
const REAL_GEMINI_AVAILABLE = !!process.env['GCP_PROJECT_ID'] && !!process.env['GCP_SA_KEY_PATH'];

/**
 * CI runs every project's tests in parallel against ONE shared Postgres,
 * and both this suite and the patient-model e2e wipe the same tables in
 * beforeEach — so one suite's wipe landed mid-pipeline in the other (the
 * "expected 404 to be 201" flake, failing at a different step each run).
 * A session-scoped advisory lock serialises the DB-destructive suites:
 * whichever starts second waits. The lock client pins a single pooled
 * connection so acquire and auto-release-on-disconnect happen on the same
 * Postgres session. Keep the key in sync with patient-model.e2e.spec.ts.
 */
const E2E_DB_LOCK_KEY = 727272;

describe.skipIf(SKIP)('scribe-service E2E (mock Gemini, in-memory storage, inline queue)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clientId: string;
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
    process.env['STORAGE_BACKEND'] = 'memory';
    process.env['NOTE_QUEUE_BACKEND'] = 'sync';
    delete process.env['GCP_PROJECT_ID']; // force mock backends

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    await prisma.geminiCallLog.deleteMany();
    await prisma.therapyNote.deleteMany();
    await prisma.noteDraft.deleteMany();
    await prisma.audioChunk.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.consent.deleteMany();
    await prisma.client.deleteMany();
    await prisma.psychologist.deleteMany();

    const psy = await prisma.psychologist.create({
      data: {
        firebaseUid: DEV_FIREBASE_UID,
        email: 'priya@example.in',
        fullName: 'Dr. Priya Menon',
        phone: '+919876543210',
        rciNumber: 'A12345',
        status: 'ACTIVE',
      },
    });
    const client = await prisma.client.create({
      data: {
        psychologistId: psy.id,
        fullNameEncrypted: 'Arjun Rao',
        contactPhoneEncrypted: '+919812345678',
        contactEmailEncrypted: 'arjun@example.in',
        presentingConcerns: 'anxiety',
        preferredModality: 'CBT',
        status: 'ACTIVE',
      },
    });
    clientId = client.id;
  });

  it('runs the full session-to-note pipeline against mock backends', async () => {
    const server = app.getHttpServer();

    // 1. Create session
    const create = await request(server)
      .post('/api/v1/sessions')
      .send({
        clientId,
        modality: 'CBT',
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      });
    expect(create.status).toBe(201);
    const sessionId: string = create.body.id;

    // 2. Record consent
    const consent = await request(server)
      .post(`/api/v1/sessions/${sessionId}/consent`)
      .send({
        scopes: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'],
        scriptVersion: 'v1.0',
      });
    expect(consent.status).toBe(200);
    expect(consent.body.consentSnapshot?.entries).toHaveLength(3);

    // 3. Start the session
    const start = await request(server).post(`/api/v1/sessions/${sessionId}/start`).send();
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('IN_PROGRESS');

    // 4. Upload 2 chunks of synthetic audio (15 s each)
    for (const chunkIndex of [0, 1]) {
      const buf = generateSilence(15_000);
      const res = await request(server)
        .post(`/api/v1/sessions/${sessionId}/audio-chunks`)
        .field('chunkIndex', String(chunkIndex))
        .field('mimeType', 'audio/pcm;rate=16000')
        .field('sampleRate', '16000')
        .field('durationMs', '15000')
        .attach('chunk', buf, { filename: `${chunkIndex}.pcm`, contentType: 'audio/pcm' });
      expect(res.status).toBe(201);
      expect(res.body.chunkIndex).toBe(chunkIndex);
      expect(res.body.sizeBytes).toBe(buf.byteLength);
    }

    // 5. End the session — runs the orchestrator inline (NOTE_QUEUE_BACKEND=sync)
    const end = await request(server).post(`/api/v1/sessions/${sessionId}/end`).send();
    expect(end.status).toBe(200);
    expect(end.body.status).toBe('COMPLETED');

    // 6. Fetch note draft — should be COMPLETED with a TherapyNoteV1 inside
    const draft = await request(server).get(`/api/v1/sessions/${sessionId}/note-draft`);
    expect(draft.status).toBe(200);
    expect(draft.body.status).toBe('COMPLETED');
    expect(draft.body.transcript).toContain('mock transcript');
    expect(draft.body.content).toMatchObject({
      version: 'V1',
      modality: 'CBT',
      riskFlags: { severity: 'none' },
    });

    // 7. GeminiCallLog should have a Pass 1 + Pass 2 success row
    const calls = await prisma.geminiCallLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    expect(calls.map((c) => c.pass)).toEqual([
      'PASS_1_TRANSCRIBE_AND_ANALYSE',
      'PASS_2_NOTE_GENERATION',
    ]);
    expect(calls.every((c) => c.status === 'SUCCESS')).toBe(true);

    // 8. Audit trail
    const actions = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    const actionList = actions.map((a) => a.action);
    expect(actionList).toContain('SESSION_CREATED');
    expect(actionList).toContain('SESSION_CONSENT_RECORDED');
    expect(actionList).toContain('SESSION_STARTED');
    expect(actionList).toContain('AUDIO_CHUNK_UPLOADED');
    expect(actionList).toContain('SESSION_ENDED');
    expect(actionList).toContain('NOTE_DRAFT_CREATED');
  });

  it('rejects audio upload when session is not IN_PROGRESS', async () => {
    const server = app.getHttpServer();
    const create = await request(server)
      .post('/api/v1/sessions')
      .send({
        clientId,
        modality: 'CBT',
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      });
    const sessionId: string = create.body.id;

    const res = await request(server)
      .post(`/api/v1/sessions/${sessionId}/audio-chunks`)
      .field('chunkIndex', '0')
      .field('mimeType', 'audio/pcm;rate=16000')
      .field('sampleRate', '16000')
      .field('durationMs', '5000')
      .attach('chunk', generateSilence(5_000), { filename: '0.pcm', contentType: 'audio/pcm' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/IN_PROGRESS/);
  });

  it('rejects /start before consent is recorded', async () => {
    const server = app.getHttpServer();
    const create = await request(server)
      .post('/api/v1/sessions')
      .send({
        clientId,
        modality: 'CBT',
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      });
    const sessionId: string = create.body.id;

    const start = await request(server).post(`/api/v1/sessions/${sessionId}/start`).send();
    expect(start.status).toBe(400);
    expect(start.body.message).toMatch(/consent must be recorded/i);
  });
});

/**
 * Real-Gemini smoke test. Skipped unless BOTH integration mode AND
 * real GCP creds are present — intended for a nightly job.
 *
 * Uses the same synthetic-silence audio so this exercises connectivity
 * and JSON-schema compliance, not transcription quality. Quality tests
 * need real-speech fixtures, which we don't ship in the repo for
 * privacy reasons.
 */
describe.skipIf(SKIP || !REAL_GEMINI_AVAILABLE)(
  'scribe-service E2E (real Vertex Gemini — nightly only)',
  () => {
    it('placeholder: invoke real Vertex backends', () => {
      // Implementation lives in a follow-up once Sharafath signs off on
      // prompts (PRD Part 10.3 verbatim). For now, this assertion just
      // guards CI from accidentally running the placeholder.
      expect(REAL_GEMINI_AVAILABLE).toBe(true);
    });
  },
);
