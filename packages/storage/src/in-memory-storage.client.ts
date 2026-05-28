import {
  type DeleteObjectInput,
  type ExistsObjectInput,
  type GetObjectInput,
  type IStorageClient,
  type PresignGetUrlInput,
  type PutObjectInput,
  StorageNotFoundError,
} from './storage.types';

interface StoredObject {
  body: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}

/**
 * In-memory IStorageClient for tests. Keys are namespaced by bucket.
 * Not thread-safe; not for production. Snapshots() / clear() exposed
 * for assertions.
 */
export class InMemoryStorageClient implements IStorageClient {
  private readonly store = new Map<string, StoredObject>();

  private k(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  put(input: PutObjectInput): Promise<void> {
    const stored: StoredObject = { body: Buffer.from(input.body) };
    if (input.contentType !== undefined) stored.contentType = input.contentType;
    if (input.metadata !== undefined) stored.metadata = input.metadata;
    this.store.set(this.k(input.bucket, input.key), stored);
    return Promise.resolve();
  }

  get(input: GetObjectInput): Promise<Buffer> {
    const obj = this.store.get(this.k(input.bucket, input.key));
    if (!obj) return Promise.reject(new StorageNotFoundError(input.bucket, input.key));
    return Promise.resolve(obj.body);
  }

  delete(input: DeleteObjectInput): Promise<void> {
    this.store.delete(this.k(input.bucket, input.key));
    return Promise.resolve();
  }

  exists(input: ExistsObjectInput): Promise<boolean> {
    return Promise.resolve(this.store.has(this.k(input.bucket, input.key)));
  }

  presignedGetUrl(input: PresignGetUrlInput): Promise<string> {
    // Deterministic fake URL — useful for asserting presign calls in tests.
    return Promise.resolve(
      `memory://${input.bucket}/${input.key}?expires=${input.expiresSec ?? 900}`,
    );
  }

  // Test helpers
  snapshot(): Map<string, StoredObject> {
    return new Map(this.store);
  }

  clear(): void {
    this.store.clear();
  }
}
