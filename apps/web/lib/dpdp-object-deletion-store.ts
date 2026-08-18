import type { PrismaClient } from '@prisma/client';
import type {
  ClaimedErasureObjectDeletionTask,
  ErasureObjectDeletionTaskStore,
} from './dpdp-object-deletion-worker';

export class PrismaErasureObjectDeletionTaskStore implements ErasureObjectDeletionTaskStore {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(input: {
    now: Date;
    leaseExpiresAt: Date;
    leaseToken: string;
  }): Promise<ClaimedErasureObjectDeletionTask | null> {
    const rows = await this.prisma.$queryRaw<ClaimedErasureObjectDeletionTask[]>`
      WITH candidate AS (
        SELECT "id"
        FROM "erasure_object_deletion_tasks"
        WHERE (
          "status" IN ('PENDING', 'FAILED')
          AND "nextAttemptAt" <= ${input.now}
        ) OR (
          "status" = 'PROCESSING'
          AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${input.now})
        )
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "erasure_object_deletion_tasks" AS task
      SET "status" = 'PROCESSING',
          "attempts" = task."attempts" + 1,
          "leaseToken" = ${input.leaseToken},
          "leaseExpiresAt" = ${input.leaseExpiresAt},
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE task."id" = candidate."id"
      RETURNING task."id", task."storageProvider", task."objectKey",
                task."leaseToken", task."completedAt", task."attempts"
    `;
    return rows[0] ?? null;
  }

  async complete(input: { id: string; leaseToken: string; now: Date }): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE "erasure_object_deletion_tasks"
      SET "status" = 'COMPLETED',
          "objectKey" = NULL,
          "completedAt" = ${input.now},
          "lastErrorCode" = NULL,
          "leaseToken" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = ${input.now}
      WHERE "id" = ${input.id}
        AND "status" = 'PROCESSING'
        AND "leaseToken" = ${input.leaseToken}
    `;
    return changed === 1;
  }

  async fail(input: {
    id: string;
    leaseToken: string;
    errorCode: string;
    nextAttemptAt: Date;
  }): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE "erasure_object_deletion_tasks"
      SET "status" = 'FAILED',
          "lastErrorCode" = ${input.errorCode},
          "nextAttemptAt" = ${input.nextAttemptAt},
          "leaseToken" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.id}
        AND "status" = 'PROCESSING'
        AND "leaseToken" = ${input.leaseToken}
    `;
    return changed === 1;
  }
}
