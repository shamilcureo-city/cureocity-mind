import type { Prisma } from '@prisma/client';

/**
 * Rolling releases may run privacy paths before this additive table is migrated.
 * Only a confirmed absent table can be skipped. Feature flags never hide PHI;
 * discovery, query or decryption errors must abort export/erasure instead.
 */
export async function hasMindSessionPreparationStorage(
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public.mind_session_preparations') IS NOT NULL AS "exists"
  `;
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.exists !== 'boolean') {
    throw new Error('Preparation storage availability could not be verified');
  }
  return rows[0].exists;
}
