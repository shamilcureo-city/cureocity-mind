import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  storage: vi.fn(),
  remove: vi.fn(),
  db: vi.fn(),
}));
vi.mock('@cureocity/storage', async (importActual) => ({
  ...(await importActual<typeof import('@cureocity/storage')>()),
  S3StorageClient: mocks.storage,
}));
vi.mock('./prisma-migration', () => ({ getMigrationPrisma: mocks.db }));
vi.mock('./dpdp-object-deletion-store', () => ({
  PrismaErasureObjectDeletionTaskStore: class {
    claim = mocks.claim;
    complete = mocks.complete;
    fail = mocks.fail;
  },
}));
import {
  GET,
  isErasureDeletionCronAuthorized,
} from '@/app/api/v1/cron/erasure-object-deletion/route';

beforeEach(() => {
  vi.resetAllMocks();
  for (const name of [
    'S3_REGION',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET_AUDIO',
    'S3_ENDPOINT',
    'S3_FORCE_PATH_STYLE',
  ])
    vi.stubEnv(name, undefined);
  vi.stubEnv('CRON_SECRET', 'worker-secret');
  mocks.claim.mockResolvedValue(null);
  mocks.complete.mockResolvedValue(true);
  mocks.fail.mockResolvedValue(true);
  mocks.storage.mockImplementation(function () {
    return { delete: mocks.remove };
  });
  mocks.remove.mockResolvedValue(undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const request = (authorization = 'Bearer worker-secret') =>
  new Request('https://mind.test/api/v1/cron/erasure-object-deletion', {
    headers: { authorization },
  }) as never;
const task = {
  id: 'synthetic-task',
  storageProvider: 'S3',
  objectKey: 'sessions/synthetic/chunks/000001.pcm',
  leaseToken: 'synthetic-lease',
  completedAt: null,
  attempts: 1,
};

describe('DPDP object-deletion cron authentication', () => {
  it('fails closed without CRON_SECRET', () => {
    expect(isErasureDeletionCronAuthorized('Bearer guessed', {})).toBe(false);
  });

  it('requires an exact bearer secret and does not trust a cron marker alone', () => {
    const env = { CRON_SECRET: 'worker-secret' };
    expect(isErasureDeletionCronAuthorized(null, env)).toBe(false);
    expect(isErasureDeletionCronAuthorized('Bearer wrong', env)).toBe(false);
    expect(isErasureDeletionCronAuthorized('Bearer worker-secret', env)).toBe(true);
  });
});

describe('DPDP cron lazy external-storage configuration', () => {
  it('rejects unauthorized requests before database or storage access', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('an empty Postgres-only outbox does not require or initialize S3', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: 0, completed: 0, failed: 0, stale: 0 });
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('actual S3 work without configuration stays retryable and reports bounded failure', async () => {
    mocks.claim.mockResolvedValueOnce(task);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      stale: 0,
      code: 'STORAGE_CONFIGURATION_MISSING',
    });
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        errorCode: 'STORAGE_CONFIGURATION_MISSING',
        nextAttemptAt: expect.any(Date),
      }),
    );
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(task.objectKey);
  });
  it('deletes only with explicit configured region and bucket, then acknowledges completion', async () => {
    vi.stubEnv('S3_REGION', 'synthetic-region');
    vi.stubEnv('S3_ACCESS_KEY', 'synthetic-key');
    vi.stubEnv('S3_SECRET_KEY', 'synthetic-secret');
    vi.stubEnv('S3_BUCKET_AUDIO', 'synthetic-audio');
    mocks.claim.mockResolvedValueOnce(task);
    expect((await GET(request())).status).toBe(200);
    expect(mocks.storage).toHaveBeenCalledWith({
      region: 'synthetic-region',
      accessKeyId: 'synthetic-key',
      secretAccessKey: 'synthetic-secret',
      forcePathStyle: false,
    });
    expect(mocks.remove).toHaveBeenCalledWith({ bucket: 'synthetic-audio', key: task.objectKey });
    expect(mocks.complete).toHaveBeenCalledOnce();
  });
  it('preserves old blank and URL tasks as failures without claiming external deletion', async () => {
    mocks.claim.mockResolvedValueOnce({ ...task, objectKey: '' }).mockResolvedValueOnce({
      ...task,
      id: 'url-task',
      objectKey: 'https://synthetic.invalid/object',
    });
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ completed: 0, failed: 2 });
    expect(mocks.fail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ errorCode: 'MISSING_OBJECT_KEY' }),
    );
    expect(mocks.fail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ errorCode: 'UNSUPPORTED_OBJECT_REFERENCE' }),
    );
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
  });
});
