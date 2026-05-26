import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  type DeleteObjectInput,
  type ExistsObjectInput,
  type GetObjectInput,
  type IStorageClient,
  type PresignGetUrlInput,
  type PutObjectInput,
  StorageNotFoundError,
} from './storage.types';

export interface S3StorageClientOptions {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3StorageClient implements IStorageClient {
  private readonly s3: S3Client;

  constructor(opts: S3StorageClientOptions) {
    const config: S3ClientConfig = {
      region: opts.region,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: opts.forcePathStyle ?? false,
    };
    if (opts.endpoint) config.endpoint = opts.endpoint;
    this.s3 = new S3Client(config);
  }

  async put(input: PutObjectInput): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
  }

  async get(input: GetObjectInput): Promise<Buffer> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      if (!res.Body) throw new StorageNotFoundError(input.bucket, input.key);
      const chunks: Uint8Array[] = [];
      // Body is a Node Readable stream in Node runtime.
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (e) {
      if (e instanceof NotFound) throw new StorageNotFoundError(input.bucket, input.key);
      throw e;
    }
  }

  async delete(input: DeleteObjectInput): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }));
  }

  async exists(input: ExistsObjectInput): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }));
      return true;
    } catch (e) {
      if (e instanceof NotFound) return false;
      const code = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 404) return false;
      throw e;
    }
  }

  async presignedGetUrl(input: PresignGetUrlInput): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: input.bucket, Key: input.key }), {
      expiresIn: input.expiresSec ?? 900,
    });
  }
}
