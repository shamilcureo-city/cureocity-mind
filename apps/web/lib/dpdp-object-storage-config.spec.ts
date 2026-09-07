import { describe, expect, it, vi } from 'vitest';
import { eraseClientPhi } from './dpdp-erasure';
import {
  ErasureStorageConfigurationError,
  erasureS3Readiness,
  legacyAudioReferenceProvider,
  readErasureS3Configuration,
} from './dpdp-object-storage-config';

describe('external deletion readiness and reference classification', () => {
  it('reports only missing setting names, never secrets or guessed defaults', () => {
    const env = { S3_REGION: ' ', S3_ACCESS_KEY: 'synthetic-secret-value' };
    const result = erasureS3Readiness(env);
    expect(result).toEqual({
      ready: false,
      missing: ['S3_REGION', 'S3_SECRET_KEY', 'S3_BUCKET_AUDIO'],
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret-value');
    expect(() => readErasureS3Configuration(env)).toThrow(ErasureStorageConfigurationError);
  });
  it.each(['', '   '])(
    'does not invent an external object for a BYTEA placeholder %j',
    (reference) => {
      expect(legacyAudioReferenceProvider(reference)).toBeNull();
    },
  );
  it.each([
    'https://synthetic.invalid/object',
    ' https://synthetic.invalid/object ',
    's3://some-bucket/object',
    '//synthetic.invalid/object',
  ])('preserves unrecognized provider reference %j without calling it S3', (reference) => {
    expect(legacyAudioReferenceProvider(reference)).toBe('UNSUPPORTED_LEGACY');
  });
  it('preserves relative object keys exactly', () => {
    expect(legacyAudioReferenceProvider('sessions/synthetic/chunks/000001.pcm')).toBe('S3');
  });
});

function erasureTx(references: string[]) {
  const enqueue = vi.fn(async () => ({ count: 0 }));
  const deletedAudio = vi.fn(async () => ({ count: references.length }));
  const tx = new Proxy(
    {},
    {
      get: (_target, property: string) => {
        if (property === '$queryRaw')
          return vi.fn(async (strings: TemplateStringsArray) =>
            Array.from(strings).join('?').includes('to_regclass') ? [{ exists: false }] : [],
          );
        if (property === '$executeRaw') return vi.fn(async () => 0);
        return new Proxy(
          {},
          {
            get: (_model, operation: string) => {
              if (property === 'erasureObjectDeletionTask' && operation === 'createMany')
                return enqueue;
              if (property === 'audioChunk' && operation === 'deleteMany') return deletedAudio;
              return vi.fn(async () => {
                if (property === 'session' && operation === 'findMany')
                  return [{ id: 'synthetic-session' }];
                if (property === 'audioChunk' && operation === 'findMany')
                  return references.map((s3Key) => ({ s3Key }));
                if (operation === 'findMany') return [];
                if (operation === 'findFirst') return null;
                if (operation === 'deleteMany' || operation === 'updateMany') return { count: 0 };
                return undefined;
              });
            },
          },
        );
      },
    },
  );
  return { tx, enqueue, deletedAudio };
}
const erasure = {
  clientId: 'synthetic-client',
  erasureRequestId: 'synthetic-erasure',
  psychologistId: 'synthetic-owner',
  now: new Date('2026-09-07T00:00:00.000Z'),
};

describe('actual erasure outbox producer with a mocked transaction', () => {
  it('deletes Postgres audio rows without creating empty external deletion tasks', async () => {
    const { tx, enqueue, deletedAudio } = erasureTx(['', '', '   ']);
    await eraseClientPhi(tx as never, erasure);
    expect(deletedAudio).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('retains real S3 keys and unresolved URL pointers while skipping inline-only rows', async () => {
    const { tx, enqueue } = erasureTx([
      '',
      'sessions/synthetic/chunks/000001.pcm',
      'https://synthetic.invalid/object',
    ]);
    await eraseClientPhi(tx as never, erasure);
    expect(enqueue).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        {
          erasureRequestId: erasure.erasureRequestId,
          storageProvider: 'S3',
          objectKey: 'sessions/synthetic/chunks/000001.pcm',
          objectKeyHashHex: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        {
          erasureRequestId: erasure.erasureRequestId,
          storageProvider: 'UNSUPPORTED_LEGACY',
          objectKey: 'https://synthetic.invalid/object',
          objectKeyHashHex: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    });
  });
});
