import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  audioFind: vi.fn(),
  segmentFind: vi.fn(),
  segmentCreate: vi.fn(),
  segmentUpdate: vi.fn(),
  segmentUpdateMany: vi.fn(),
  callLogCreate: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  sessionFind: vi.fn(),
  pass1: vi.fn(),
  assertAuthority: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
    session: { findUnique: mocks.sessionFind },
    audioChunk: { findUnique: mocks.audioFind },
    transcriptSegment: {
      findUnique: mocks.segmentFind,
      create: mocks.segmentCreate,
      update: mocks.segmentUpdate,
      updateMany: mocks.segmentUpdateMany,
    },
    geminiCallLog: { create: mocks.callLogCreate },
  },
}));
vi.mock('./llm', () => ({ modelRouter: () => ({ pass1: mocks.pass1 }) }));
vi.mock('./scribe-authority', () => ({ assertCurrentScribeAuthority: mocks.assertAuthority }));
vi.mock('./audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('@cureocity/observability/metrics', () => ({ recordGeminiCall: vi.fn() }));

import { transcribeChunkInline } from './transcribe-segment';

function callLog() {
  return {
    sessionId: 'session-1',
    pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
    model: 'model',
    region: 'region',
    promptVersion: 'v1',
    inputTokens: 1,
    outputTokens: 1,
    costInr: 0,
    latencyMs: 1,
    status: 'SUCCESS',
  };
}

let retainedAudio: Buffer;
let modelAudio: Buffer | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  mocks.sessionFind.mockResolvedValue({
    id: 'session-1',
    clientId: 'client-1',
    psychologistId: 'psy-1',
    status: 'IN_PROGRESS',
  });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: mocks.queryRaw,
      session: { findUnique: mocks.sessionFind },
      transcriptSegment: {
        create: mocks.segmentCreate,
        update: mocks.segmentUpdate,
        updateMany: mocks.segmentUpdateMany,
      },
      geminiCallLog: { create: mocks.callLogCreate },
    }),
  );
  modelAudio = undefined;
  retainedAudio = Buffer.from([1, 2, 3, 4]);
  mocks.audioFind.mockResolvedValue({
    id: 'chunk-1',
    durationMs: 1_000,
    sizeBytes: 4,
    bytes: retainedAudio,
    session: {
      id: 'session-1',
      psychologistId: 'psy-1',
      client: { spokenLanguages: [] },
      psychologist: { vertical: 'DOCTOR' },
    },
  });
  mocks.segmentFind.mockResolvedValue(null);
  mocks.segmentCreate.mockResolvedValue({ id: 'segment-1' });
  mocks.segmentUpdate.mockResolvedValue({ sessionId: 'session-1', chunkIndex: 0, attempts: 1 });
  mocks.pass1.mockImplementation(async ({ audioBytes }) => {
    modelAudio = audioBytes;
    return {
      output: {
        transcript: 'sensitive transcript',
        speakerSegments: [],
        affectFeatures: [],
        detectedLanguages: [],
      },
      callLog: callLog(),
    };
  });
});

describe('per-chunk background authority', () => {
  it('aborts and zeroes retained audio when consent is withdrawn before model execution', async () => {
    mocks.assertAuthority.mockRejectedValue(new Error('authority denied'));

    await expect(transcribeChunkInline({ sessionId: 'session-1', chunkIndex: 0 })).resolves.toEqual(
      { status: 'failed', reason: 'authorization-denied' },
    );

    expect(mocks.pass1).not.toHaveBeenCalled();
    expect(retainedAudio.equals(Buffer.alloc(retainedAudio.length))).toBe(true);
    expect(mocks.callLogCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('sensitive transcript');
  });

  it('drops model output when authority is withdrawn before persistence', async () => {
    mocks.assertAuthority
      .mockResolvedValueOnce({ psychologistId: 'psy-1' })
      .mockRejectedValueOnce(new Error('authority denied'));

    await expect(transcribeChunkInline({ sessionId: 'session-1', chunkIndex: 0 })).resolves.toEqual(
      { status: 'failed', reason: 'authorization-denied' },
    );

    expect(mocks.pass1).toHaveBeenCalledOnce();
    expect(mocks.assertAuthority).toHaveBeenCalledTimes(2);
    expect(modelAudio?.equals(Buffer.alloc(modelAudio.length))).toBe(true);
    expect(mocks.callLogCreate).not.toHaveBeenCalled();
    expect(mocks.segmentUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transcript: 'sensitive transcript' }),
      }),
    );
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('sensitive transcript');
  });

  it('uses completion-only authority sources for the End-session backstop', async () => {
    mocks.assertAuthority.mockResolvedValue({ psychologistId: 'psy-1' });

    await expect(
      transcribeChunkInline({ sessionId: 'session-1', chunkIndex: 0, fromBackstop: true }),
    ).resolves.toMatchObject({ status: 'completed' });

    expect(mocks.assertAuthority.mock.calls.map(([, boundary]) => boundary.source)).toEqual([
      'transcribeChunkBackstopBeforeModel',
      'transcribeChunkBackstopBeforePersistence',
    ]);
  });
});
