import type { Prisma } from '@prisma/client';
import type { PractitionerCapability } from '@cureocity/contracts';
import { decryptForTenant } from './tenant-crypto';
import { lockActiveClient } from './phi-write-lock';

/** Privacy discovery is independent of UI flags and fails closed on database errors. */
export async function hasScribeWorkspaceStorage(tx: Prisma.TransactionClient): Promise<boolean> {
  const result = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public.scribe_workspace_records') IS NOT NULL AS "exists"
  `;
  if (result.length !== 1 || typeof result[0]?.exists !== 'boolean') {
    throw new Error('Scribe storage availability could not be verified');
  }
  return result[0].exists;
}

/** Intake credentials are not patient chart data and must never be exported. */
export function redactScribeExportCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactScribeExportCredentials);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['tokenHash', 'token', 'accessToken', 'grantToken'].includes(key))
        .map(([key, child]) => [key, redactScribeExportCredentials(child)]),
    );
  }
  return value;
}

export async function loadScribeWorkspaceExport(
  tx: Prisma.TransactionClient,
  clientId: string,
  psychologistId: string,
  capabilities: ReadonlySet<PractitionerCapability>,
) {
  await lockActiveClient(tx, clientId, psychologistId);
  if (!capabilities.has('MEDICAL_DOCUMENTATION')) return { omittedScribeWorkspace: true };
  if (!(await hasScribeWorkspaceStorage(tx))) return { scribeWorkspaceRecords: [] };
  const records: Array<{
    id: string;
    kind: string;
    sessionId: string | null;
    revision: number;
    createdAt: string;
    updatedAt: string;
    body: unknown;
  }> = [];
  let afterId: string | undefined;
  // Originals can be large. Bound decryption memory without omitting older records.
  for (;;) {
    const rows = await tx.scribeWorkspaceRecord.findMany({
      where: { clientId, psychologistId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
      ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
    });
    for (const row of rows) {
      const text = await decryptForTenant(psychologistId, row.bodyEncrypted);
      if (text === null) throw new Error('Scribe export data unavailable');
      const decoded = JSON.parse(text) as Record<string, unknown>;
      // Full originals are downloadable individually through an authenticated endpoint;
      // embedding every PDF in one JSON response can exceed the host's response limit.
      if (row.kind === 'report' && decoded.original && typeof decoded.original === 'object') {
        const { base64: _bytes, ...metadata } = decoded.original as Record<string, unknown>;
        decoded.original = {
          ...metadata,
          authenticatedDownloadPath: `/api/v1/scribe/reports/${encodeURIComponent(row.id)}/original`,
          exportNote: 'Download the original separately while signed in as the treating doctor.',
        };
      }
      const body = redactScribeExportCredentials(decoded);
      records.push({
        id: row.id,
        kind: row.kind,
        sessionId: row.sessionId,
        revision: row.revision,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        body,
      });
    }
    if (rows.length < 5) break;
    afterId = rows[rows.length - 1]!.id;
  }
  return { scribeWorkspaceRecords: records };
}
