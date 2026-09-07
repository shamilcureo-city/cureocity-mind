import { S3StorageClient } from '@cureocity/storage';
import { NextResponse, type NextRequest } from 'next/server';
import { PrismaErasureObjectDeletionTaskStore } from '@/lib/dpdp-object-deletion-store';
import { runErasureObjectDeletionWorker } from '@/lib/dpdp-object-deletion-worker';
import { getMigrationPrisma } from '@/lib/prisma-migration';
import {
  ErasureStorageConfigurationError,
  readErasureS3Configuration,
} from '@/lib/dpdp-object-storage-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export function isErasureDeletionCronAuthorized(
  authorization: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const secret = env['CRON_SECRET'];
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

/** Protected outbox worker; CRON_SECRET is required even for Vercel cron. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isErasureDeletionCronAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Most web recordings live entirely in Postgres. Only actual legacy S3 work
  // needs object-storage configuration; an empty outbox must not require it.
  let storage: S3StorageClient | undefined;
  let bucket: string | undefined;
  let configurationMissing = false;
  const result = await runErasureObjectDeletionWorker({
    store: new PrismaErasureObjectDeletionTaskStore(getMigrationPrisma()),
    remove: async ({ key }) => {
      if (!storage) {
        try {
          const config = readErasureS3Configuration(process.env);
          bucket = config.bucket;
          storage = new S3StorageClient(config.options);
        } catch (error) {
          if (error instanceof ErasureStorageConfigurationError) configurationMissing = true;
          throw error;
        }
      }
      await storage.delete({ bucket: bucket!, key });
    },
    log: ({ event, taskId, errorCode }) => {
      // Task IDs and bounded codes only. Never log object keys or provider errors.
      console.info('[dpdp-object-deletion]', { event, taskId, ...(errorCode && { errorCode }) });
    },
  });

  return NextResponse.json(
    { ...result, ...(configurationMissing ? { code: 'STORAGE_CONFIGURATION_MISSING' } : {}) },
    { status: configurationMissing ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
