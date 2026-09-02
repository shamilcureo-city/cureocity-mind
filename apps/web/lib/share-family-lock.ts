import { Prisma } from '@prisma/client';

export type ShareFamilyIdentity = {
  id: string;
  shareBatchId: string | null;
};

export function shareFamilyLockKey(share: ShareFamilyIdentity): string {
  return `share-family:${share.shareBatchId ?? share.id}`;
}

/**
 * Family lock ordering invariant: acquire this lock before any share-row,
 * assignment, client-dispatch, or rate-cap advisory lock used by a mutation.
 */
export async function lockShareFamily(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  share: ShareFamilyIdentity,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${shareFamilyLockKey(share)}))`,
  );
}
