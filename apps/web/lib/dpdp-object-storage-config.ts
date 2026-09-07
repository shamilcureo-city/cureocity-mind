import type { S3StorageClientOptions } from '@cureocity/storage';

const REQUIRED_S3_ENV = ['S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET_AUDIO'] as const;
type StorageEnv = Readonly<Record<string, string | undefined>>;

/** Configuration names only: safe for readiness checks without exposing values. */
export function erasureS3Readiness(env: StorageEnv) {
  const missing = REQUIRED_S3_ENV.filter((name) => !env[name]?.trim());
  return { ready: missing.length === 0, missing };
}

export class ErasureStorageConfigurationError extends Error {
  constructor() {
    super('External object deletion storage is not configured.');
    this.name = 'ErasureStorageConfigurationError';
  }
}

/** Never infer a production region, bucket, endpoint or credentials. */
export function readErasureS3Configuration(env: StorageEnv): {
  bucket: string;
  options: S3StorageClientOptions;
} {
  if (!erasureS3Readiness(env).ready) throw new ErasureStorageConfigurationError();
  return {
    bucket: env['S3_BUCKET_AUDIO']!,
    options: {
      region: env['S3_REGION']!,
      accessKeyId: env['S3_ACCESS_KEY']!,
      secretAccessKey: env['S3_SECRET_KEY']!,
      ...(env['S3_ENDPOINT'] ? { endpoint: env['S3_ENDPOINT'] } : {}),
      forcePathStyle: env['S3_FORCE_PATH_STYLE'] === 'true',
    },
  };
}

/** Current BYTEA uploads have no external reference. Preserve unresolved legacy
 * URLs, but never send them as S3 keys: a no-op S3 delete could falsely certify
 * deletion of an object in a different provider or bucket. */
export function legacyAudioReferenceProvider(
  reference: string,
): 'S3' | 'UNSUPPORTED_LEGACY' | null {
  const candidate = reference.trim();
  if (!candidate) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(candidate) || candidate.startsWith('//'))
    return 'UNSUPPORTED_LEGACY';
  return 'S3';
}
