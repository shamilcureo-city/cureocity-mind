export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectInput {
  bucket: string;
  key: string;
}

export interface DeleteObjectInput {
  bucket: string;
  key: string;
}

export interface ExistsObjectInput {
  bucket: string;
  key: string;
}

export interface PresignGetUrlInput {
  bucket: string;
  key: string;
  expiresSec?: number;
}

export interface IStorageClient {
  put(input: PutObjectInput): Promise<void>;
  get(input: GetObjectInput): Promise<Buffer>;
  delete(input: DeleteObjectInput): Promise<void>;
  exists(input: ExistsObjectInput): Promise<boolean>;
  presignedGetUrl(input: PresignGetUrlInput): Promise<string>;
}

export class StorageNotFoundError extends Error {
  constructor(bucket: string, key: string) {
    super(`Object not found: s3://${bucket}/${key}`);
    this.name = 'StorageNotFoundError';
  }
}
