import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InMemoryStorageClient } from '@cureocity/storage';
import { AudioService } from './audio.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ConfigService } from '@nestjs/config';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const SESSION_ID = 'csess11111111111111111111';

const inProgressSession = {
  id: SESSION_ID,
  psychologistId: PSY_ID,
  status: 'IN_PROGRESS' as const,
};

const validInput = {
  chunkIndex: 0,
  mimeType: 'audio/pcm;rate=16000',
  sampleRate: 16000,
  durationMs: 5000,
  body: Buffer.alloc(1024, 0xab),
};

function makeConfig(overrides?: Record<string, unknown>): ConfigService {
  const defaults: Record<string, unknown> = {
    S3_BUCKET_AUDIO: 'audio',
    AUDIO_ACCEPTED_MIME: 'audio/pcm',
    AUDIO_ACCEPTED_SAMPLE_RATE: 16000,
    AUDIO_MAX_CHUNK_BYTES: 15 * 1024 * 1024,
    ...overrides,
  };
  return { get: (k: string) => defaults[k] } as ConfigService;
}

function makeDeps(opts: {
  session?: typeof inProgressSession | null | { status: string; psychologistId?: string };
  configOverrides?: Record<string, unknown>;
  audioCreate?: ReturnType<typeof vi.fn>;
}) {
  const session = opts.session === undefined ? inProgressSession : opts.session;
  const sessionFindUnique = vi.fn().mockResolvedValue(session);
  const audioCreate = opts.audioCreate ?? vi.fn();
  const txClient = { audioChunk: { create: audioCreate } };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
  const prisma = {
    session: { findUnique: sessionFindUnique },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  const storage = new InMemoryStorageClient();
  const config = makeConfig(opts.configOverrides);
  return { prisma, audit, storage, config, sessionFindUnique, audioCreate };
}

describe('AudioService.uploadChunk', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: stores in S3, persists row, writes audit', async () => {
    const deps = makeDeps({
      audioCreate: vi.fn().mockImplementation(async ({ data }) => ({
        id: 'audio_1',
        ...data,
        uploadedAt: new Date('2026-06-01T12:00:00Z'),
      })),
    });
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    const result = await svc.uploadChunk(PSY_ID, SESSION_ID, validInput, {});

    expect(result.id).toBe('audio_1');
    expect(result.s3Key).toBe(`sessions/${SESSION_ID}/chunks/000000.pcm`);
    expect(result.sizeBytes).toBe(1024);

    const stored = deps.storage.snapshot();
    expect(stored.has(`audio/sessions/${SESSION_ID}/chunks/000000.pcm`)).toBe(true);

    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUDIO_CHUNK_UPLOADED', targetType: 'AudioChunk' }),
      expect.anything(),
    );
  });

  it('rejects non-PCM mimeType (415)', async () => {
    const deps = makeDeps({});
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(
      svc.uploadChunk(PSY_ID, SESSION_ID, { ...validInput, mimeType: 'audio/wav' }, {}),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects wrong sample rate', async () => {
    const deps = makeDeps({});
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(
      svc.uploadChunk(PSY_ID, SESSION_ID, { ...validInput, sampleRate: 44100 }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized chunk', async () => {
    const deps = makeDeps({ configOverrides: { AUDIO_MAX_CHUNK_BYTES: 100 } });
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(
      svc.uploadChunk(PSY_ID, SESSION_ID, { ...validInput, body: Buffer.alloc(200) }, {}),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects empty body', async () => {
    const deps = makeDeps({});
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(
      svc.uploadChunk(PSY_ID, SESSION_ID, { ...validInput, body: Buffer.alloc(0) }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects negative chunkIndex', async () => {
    const deps = makeDeps({});
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(
      svc.uploadChunk(PSY_ID, SESSION_ID, { ...validInput, chunkIndex: -1 }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for cross-tenant session', async () => {
    const deps = makeDeps({
      session: { ...inProgressSession, psychologistId: OTHER_PSY_ID },
    });
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(svc.uploadChunk(PSY_ID, SESSION_ID, validInput, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s for missing session', async () => {
    const deps = makeDeps({ session: null });
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(svc.uploadChunk(PSY_ID, SESSION_ID, validInput, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects upload when session is not IN_PROGRESS', async () => {
    const deps = makeDeps({
      session: { ...inProgressSession, status: 'COMPLETED' },
    });
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(svc.uploadChunk(PSY_ID, SESSION_ID, validInput, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('translates duplicate chunkIndex (P2002) to ConflictException and rolls back S3 put', async () => {
    const deps = makeDeps({
      audioCreate: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['sessionId', 'chunkIndex'] },
        }),
      ),
    });
    const svc = new AudioService(deps.prisma, deps.audit, deps.config, deps.storage);
    await expect(svc.uploadChunk(PSY_ID, SESSION_ID, validInput, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    // S3 object should be removed after the conflict.
    expect(deps.storage.snapshot().size).toBe(0);
  });
});
