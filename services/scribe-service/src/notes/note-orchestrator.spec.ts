import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { InMemoryStorageClient } from '@cureocity/storage';
import type { ConfigService } from '@nestjs/config';
import type { IModelRouter, TherapyNoteV1 } from '@cureocity/llm';
import { NoteOrchestrator } from './note-orchestrator';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const SESSION_ID = 'csess11111111111111111111';
const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const CLIENT_ID = 'cclient11111111111111111x';
const BUCKET = 'audio';

const baseSession = {
  id: SESSION_ID,
  psychologistId: PSY_ID,
  clientId: CLIENT_ID,
  modality: 'CBT' as const,
  status: 'COMPLETED' as const,
  scheduledAt: new Date(),
  startedAt: new Date(),
  endedAt: new Date(),
  consentSnapshot: null,
  phaseSnapshot: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  client: {
    id: CLIENT_ID,
    presentingConcerns: 'anxiety',
    preferredModality: 'CBT' as const,
  },
};

const baseDraft = {
  id: 'draft_1',
  sessionId: SESSION_ID,
  status: 'IN_PROGRESS' as const,
  transcript: null,
  speakerSegments: null,
  affectFeatures: null,
  content: null,
  riskSeverity: null,
  totalCostInr: new Prisma.Decimal(0),
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRouter(opts: {
  pass1Output?: ReturnType<typeof makePass1Output>;
  pass2NoteOverride?: Partial<TherapyNoteV1>;
  pass1Throws?: boolean;
}): IModelRouter {
  return {
    pass1: vi.fn(async () => {
      if (opts.pass1Throws) throw new Error('pass1 boom');
      return {
        output: opts.pass1Output ?? makePass1Output(),
        callLog: {
          sessionId: SESSION_ID,
          pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE' as const,
          model: 'mock-flash',
          region: 'asia-south1',
          promptVersion: 'P1',
          inputTokens: 1000,
          outputTokens: 200,
          costInr: 1.5,
          latencyMs: 100,
          status: 'SUCCESS' as const,
        },
      };
    }),
    pass2: vi.fn(async () => {
      const note: TherapyNoteV1 = {
        version: 'V1',
        modality: 'CBT',
        subjective: 's',
        objective: 'o',
        assessment: 'a',
        plan: 'p',
        riskFlags: {
          severity: 'none',
          indicators: [],
          ...(opts.pass2NoteOverride?.riskFlags ?? {}),
        },
        phaseHints: [],
        ...opts.pass2NoteOverride,
      };
      return {
        output: { therapyNote: note },
        callLog: {
          sessionId: SESSION_ID,
          pass: 'PASS_2_NOTE_GENERATION' as const,
          model: 'mock-pro',
          region: 'us-central1',
          promptVersion: 'P2',
          inputTokens: 500,
          outputTokens: 400,
          costInr: 2.5,
          latencyMs: 200,
          status: 'SUCCESS' as const,
        },
      };
    }),
  };
}

function makePass1Output() {
  return {
    transcript: 'hello',
    speakerSegments: [{ speaker: 'therapist' as const, startMs: 0, endMs: 1000, text: 'hi' }],
    affectFeatures: [{ startMs: 0, endMs: 1000, valence: 0, arousal: 0.5 }],
  };
}

function makeDeps(opts: {
  audioChunks?: Array<{ chunkIndex: number; s3Key: string; durationMs: number }>;
  router?: IModelRouter;
}) {
  const sessionFindUnique = vi.fn().mockResolvedValue(baseSession);
  const noteDraftUpsert = vi.fn().mockResolvedValue(baseDraft);
  const noteDraftUpdate = vi.fn().mockResolvedValue(baseDraft);
  const audioChunkFindMany = vi.fn().mockResolvedValue(opts.audioChunks ?? []);
  const prisma = {
    session: { findUnique: sessionFindUnique },
    noteDraft: { upsert: noteDraftUpsert, update: noteDraftUpdate },
    audioChunk: { findMany: audioChunkFindMany },
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  const config = {
    get: (k: string) => (k === 'S3_BUCKET_AUDIO' ? BUCKET : undefined),
  } as ConfigService;
  const storage = new InMemoryStorageClient();
  const router = opts.router ?? makeRouter({});
  return {
    prisma,
    audit,
    config,
    storage,
    router,
    sessionFindUnique,
    noteDraftUpsert,
    noteDraftUpdate,
    audioChunkFindMany,
  };
}

describe('NoteOrchestrator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: runs pass 1 + pass 2 and completes the draft', async () => {
    const deps = makeDeps({
      audioChunks: [
        { chunkIndex: 0, s3Key: 'a/0.pcm', durationMs: 5_000 },
        { chunkIndex: 1, s3Key: 'a/1.pcm', durationMs: 5_000 },
      ],
    });
    await deps.storage.put({ bucket: BUCKET, key: 'a/0.pcm', body: Buffer.alloc(100, 1) });
    await deps.storage.put({ bucket: BUCKET, key: 'a/1.pcm', body: Buffer.alloc(100, 2) });

    const orch = new NoteOrchestrator(
      deps.prisma,
      deps.audit,
      deps.config,
      deps.storage,
      deps.router,
    );
    await orch.run(SESSION_ID);

    expect(deps.router.pass1).toHaveBeenCalledOnce();
    expect(deps.router.pass2).toHaveBeenCalledOnce();
    // upsert (PENDING→IN_PROGRESS) + 2 updates (after Pass 1, after Pass 2)
    expect(deps.noteDraftUpsert).toHaveBeenCalledTimes(1);
    expect(deps.noteDraftUpdate).toHaveBeenCalledTimes(2);
    // Should write NOTE_DRAFT_CREATED audit
    const actions = (deps.audit.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    );
    expect(actions).toContain('NOTE_DRAFT_CREATED');
    // No crisis flag for severity=none
    expect(actions).not.toContain('CRISIS_FLAG_RAISED');
  });

  it('writes CRISIS_FLAG_RAISED audit when severity is high', async () => {
    const deps = makeDeps({
      audioChunks: [{ chunkIndex: 0, s3Key: 'a/0.pcm', durationMs: 5_000 }],
      router: makeRouter({
        pass2NoteOverride: {
          riskFlags: { severity: 'high', indicators: ['suicidal ideation'] },
        },
      }),
    });
    await deps.storage.put({ bucket: BUCKET, key: 'a/0.pcm', body: Buffer.alloc(100, 1) });

    const orch = new NoteOrchestrator(
      deps.prisma,
      deps.audit,
      deps.config,
      deps.storage,
      deps.router,
    );
    await orch.run(SESSION_ID);

    const actions = (deps.audit.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    );
    expect(actions).toContain('NOTE_DRAFT_CREATED');
    expect(actions).toContain('CRISIS_FLAG_RAISED');
  });

  it('marks draft FAILED when no audio chunks exist', async () => {
    const deps = makeDeps({ audioChunks: [] });
    const orch = new NoteOrchestrator(
      deps.prisma,
      deps.audit,
      deps.config,
      deps.storage,
      deps.router,
    );
    await orch.run(SESSION_ID);

    // upsert (initial) + update (FAILED) = 2 calls; pass2 never reached
    expect(deps.router.pass1).not.toHaveBeenCalled();
    const lastUpdate = (deps.noteDraftUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect((lastUpdate[0] as { data: { status: string } }).data.status).toBe('FAILED');
  });

  it('marks draft FAILED when Pass 1 throws', async () => {
    const deps = makeDeps({
      audioChunks: [{ chunkIndex: 0, s3Key: 'a/0.pcm', durationMs: 5_000 }],
      router: makeRouter({ pass1Throws: true }),
    });
    await deps.storage.put({ bucket: BUCKET, key: 'a/0.pcm', body: Buffer.alloc(100, 1) });
    const orch = new NoteOrchestrator(
      deps.prisma,
      deps.audit,
      deps.config,
      deps.storage,
      deps.router,
    );
    await orch.run(SESSION_ID);

    const lastUpdate = (deps.noteDraftUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect((lastUpdate[0] as { data: { status: string } }).data.status).toBe('FAILED');
    expect((lastUpdate[0] as { data: { errorMessage: string } }).data.errorMessage).toMatch(
      /pass1 boom/,
    );
  });

  it('returns early when the session does not exist', async () => {
    const deps = makeDeps({});
    deps.sessionFindUnique.mockResolvedValue(null);
    const orch = new NoteOrchestrator(
      deps.prisma,
      deps.audit,
      deps.config,
      deps.storage,
      deps.router,
    );
    await orch.run('missing-session');
    expect(deps.noteDraftUpsert).not.toHaveBeenCalled();
  });
});
