import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  create: vi.fn(),
  existing: vi.fn(),
  last: vi.fn(),
  after: vi.fn(),
  lock: vi.fn(),
  consent: vi.fn(),
  capability: vi.fn(),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: async () => ({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  }),
  requireCapability: mocks.capability,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findUnique: mocks.session },
    audioChunk: { findUnique: mocks.existing },
    $transaction: async (work: (tx: unknown) => unknown) =>
      work({
        session: { findUnique: mocks.session },
        audioChunk: { create: mocks.create, findFirst: mocks.last },
      }),
  },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), auditMetadataFromRequest: () => ({}) }));
vi.mock('@/lib/transcribe-segment', () => ({ transcribeChunkInline: vi.fn() }));
vi.mock('@/lib/phi-write-lock', () => ({
  lockActiveClientForSession: mocks.lock,
  ClientPhiWriteForbiddenError: class extends Error {},
}));
vi.mock('@/lib/consent-gate', () => ({
  assertValidScribeConsent: mocks.consent,
  consentAuthorizationResponse: (error: Error) =>
    error.message === 'consent withdrawn'
      ? NextResponse.json({ error: 'Consent withdrawn' }, { status: 409 })
      : null,
}));
import { POST } from '../../app/api/v1/audio/chunks/upload/route';
import { GET } from '../../app/api/v1/sessions/[id]/audio-cursor/route';

const audio = Buffer.from([1, 2, 3, 4]);
const session = {
  psychologistId: 'psy-1',
  clientId: 'client-1',
  status: 'IN_PROGRESS',
  consentSnapshot: {},
  mindDocumentationMode: 'AI_SCRIBE',
  noteDraft: null,
};
const request = () =>
  new NextRequest('https://mind.example/api/v1/audio/chunks/upload', {
    method: 'POST',
    body: audio,
    headers: {
      'content-type': 'audio/pcm',
      'x-session-id': 'session-1',
      'x-chunk-index': '0',
      'x-duration-ms': '1000',
      'x-sample-rate': '16000',
    },
  });
const cursor = () =>
  GET(new NextRequest('https://mind.example/api/v1/sessions/session-1/audio-cursor'), {
    params: Promise.resolve({ id: 'session-1' }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ ...session });
  mocks.capability.mockResolvedValue({ ok: true });
  mocks.lock.mockResolvedValue({ id: 'client-1' });
  mocks.last.mockResolvedValue(null);
  mocks.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('ordinal conflict', {
      code: 'P2002',
      clientVersion: 'test',
    }),
  );
  mocks.existing.mockResolvedValue({
    bytes: audio,
    mimeType: 'audio/pcm',
    durationMs: 1000,
    sampleRate: 16000,
  });
});

describe('acknowledged audio is byte-checked', () => {
  it('acknowledges an exact byte and metadata retry', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deduplicated: true });
    expect(mocks.after).toHaveBeenCalledOnce();
  });
  it.each([
    { bytes: Buffer.from([5, 6, 7, 8]) },
    { bytes: null },
    { durationMs: 2000 },
    { sampleRate: 8000 },
    { mimeType: 'audio/wav' },
  ])('rejects different audio at the same ordinal: %o', async (difference) => {
    mocks.existing.mockResolvedValue({
      bytes: audio,
      mimeType: 'audio/pcm',
      durationMs: 1000,
      sampleRate: 16000,
      ...difference,
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'AUDIO_CHUNK_CONFLICT' });
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

describe('server recording cursor', () => {
  it('starts after the highest acknowledged ordinal, not the number of rows', async () => {
    mocks.last.mockResolvedValue({ chunkIndex: 12 });
    const response = await cursor();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ nextChunkIndex: 13 });
    expect(mocks.consent).toHaveBeenCalledOnce();
    expect(mocks.last).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { chunkIndex: 'desc' } }),
    );
  });
  it('uses zero only for a verified empty server session', async () => {
    expect(await (await cursor()).json()).toEqual({ nextChunkIndex: 0 });
  });
  it('allows consented scheduled capture before the UI marks it in progress', async () => {
    mocks.session.mockResolvedValue({ ...session, status: 'SCHEDULED' });
    expect(await (await cursor()).json()).toEqual({ nextChunkIndex: 0 });
    expect(mocks.consent).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{ status: 'COMPLETED' }, { mindDocumentationMode: 'MANUAL' }])(
    'does not reopen unavailable capture: %o',
    async (difference) => {
      mocks.session.mockResolvedValue({ ...session, ...difference });
      expect((await cursor()).status).toBe(409);
      expect(mocks.last).not.toHaveBeenCalled();
    },
  );
  it('denies a foreign tenant before audio lookup', async () => {
    mocks.session.mockResolvedValue({ ...session, psychologistId: 'other-psy' });
    expect((await cursor()).status).toBe(404);
    expect(mocks.last).not.toHaveBeenCalled();
  });
  it('does not return a cursor when consent has been withdrawn', async () => {
    mocks.consent.mockRejectedValue(new Error('consent withdrawn'));
    expect((await cursor()).status).toBe(409);
    expect(mocks.last).not.toHaveBeenCalled();
  });
  it('fails closed on storage errors rather than resetting to zero', async () => {
    mocks.last.mockRejectedValue(new Error('storage unavailable'));
    expect((await cursor()).status).toBe(503);
  });
});
