import type { Prisma } from '@prisma/client';

/** Privacy survives feature rollback; only catalog-confirmed table absence is empty history. */
export async function hasSessionUsageConnectionStorage(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public.session_usage_connections') IS NOT NULL AS "exists"
  `;
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.exists !== 'boolean')
    throw new Error('Session usage storage availability could not be verified');
  return rows[0].exists;
}
