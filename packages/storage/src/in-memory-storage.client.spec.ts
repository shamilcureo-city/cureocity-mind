import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorageClient } from './in-memory-storage.client';
import { StorageNotFoundError } from './storage.types';

describe('InMemoryStorageClient', () => {
  let storage: InMemoryStorageClient;

  beforeEach(() => {
    storage = new InMemoryStorageClient();
  });

  it('round-trips put → get', async () => {
    await storage.put({
      bucket: 'b',
      key: 'k',
      body: Buffer.from('hello world'),
      contentType: 'text/plain',
    });
    const got = await storage.get({ bucket: 'b', key: 'k' });
    expect(got.toString('utf8')).toBe('hello world');
  });

  it('rejects get on missing key with StorageNotFoundError', async () => {
    await expect(storage.get({ bucket: 'b', key: 'missing' })).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
  });

  it('exists returns true/false correctly', async () => {
    await storage.put({ bucket: 'b', key: 'k', body: Buffer.from('x') });
    expect(await storage.exists({ bucket: 'b', key: 'k' })).toBe(true);
    expect(await storage.exists({ bucket: 'b', key: 'nope' })).toBe(false);
  });

  it('delete removes the key', async () => {
    await storage.put({ bucket: 'b', key: 'k', body: Buffer.from('x') });
    await storage.delete({ bucket: 'b', key: 'k' });
    expect(await storage.exists({ bucket: 'b', key: 'k' })).toBe(false);
  });

  it('presignedGetUrl returns deterministic fake URL', async () => {
    const url = await storage.presignedGetUrl({ bucket: 'b', key: 'k', expiresSec: 60 });
    expect(url).toBe('memory://b/k?expires=60');
  });

  it('namespaces by bucket', async () => {
    await storage.put({ bucket: 'b1', key: 'k', body: Buffer.from('one') });
    await storage.put({ bucket: 'b2', key: 'k', body: Buffer.from('two') });
    expect((await storage.get({ bucket: 'b1', key: 'k' })).toString()).toBe('one');
    expect((await storage.get({ bucket: 'b2', key: 'k' })).toString()).toBe('two');
  });
});
