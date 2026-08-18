import { S3StorageClient } from '@cureocity/storage';
import { NextResponse, type NextRequest } from 'next/server';
import { PrismaErasureObjectDeletionTaskStore } from '@/lib/dpdp-object-deletion-store';
import { runErasureObjectDeletionWorker } from '@/lib/dpdp-object-deletion-worker';
import { getMigrationPrisma } from '@/lib/prisma-migration';

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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the DPDP object-deletion worker`);
  return value;
}

/** Protected outbox worker; CRON_SECRET is required even for Vercel cron. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isErasureDeletionCronAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const endpoint = process.env['S3_ENDPOINT'];
  const storage = new S3StorageClient({
    region: requiredEnv('S3_REGION'),
    accessKeyId: requiredEnv('S3_ACCESS_KEY'),
    secretAccessKey: requiredEnv('S3_SECRET_KEY'),
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
  });
  const result = await runErasureObjectDeletionWorker({
    store: new PrismaErasureObjectDeletionTaskStore(getMigrationPrisma()),
    remove: (input) => storage.delete(input),
    bucket: requiredEnv('S3_BUCKET_AUDIO'),
    log: ({ event, taskId, errorCode }) => {
      // Task IDs and bounded codes only. Never log object keys or provider errors.
      console.info('[dpdp-object-deletion]', { event, taskId, ...(errorCode && { errorCode }) });
    },
  });

  return NextResponse.json(result);
}
