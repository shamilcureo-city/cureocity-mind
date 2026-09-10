import { prisma } from './prisma';
import { MindManualNoteFieldsSchema } from '@cureocity/contracts';
import { getEffectiveCapabilities } from './capabilities';
import { decryptForTenant } from './tenant-crypto';
import { ClientPhiWriteForbiddenError, lockActiveClient } from './phi-write-lock';

export interface ClinicianDocumentedRisk {
  severity: 'high' | 'critical';
  sourceSessionId: string;
  recordedAt: string;
  sourceStatus: 'COMPLETED' | 'UNFINISHED';
}

/** Saved clinician-written assessments are safety context, not AI reports or a
 * claim about current risk. A later visit alone never erases this context. A
 * documented correction of the source note is reflected on the next read. */
export async function fetchClinicianDocumentedRisk(
  clientId: string,
  psychologistId?: string,
): Promise<ClinicianDocumentedRisk | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, deletedAt: null, ...(psychologistId ? { psychologistId } : {}) },
    select: { psychologistId: true },
  });
  if (!client) return null;
  const effective = await getEffectiveCapabilities(client.psychologistId);
  if (!effective.capabilities.has('BEHAVIORAL_HEALTH_DOCUMENTATION')) return null;
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Erasure takes this same client-row lock. All clinical reads and
        // decryption finish before it is released; recheck ownership while held.
        await lockActiveClient(tx, clientId, client.psychologistId);
        const sessionScope = {
          clientId,
          psychologistId: client.psychologistId,
          mindDocumentationMode: 'MANUAL' as const,
          client: { deletedAt: null },
        };
        const [row, drafts] = await Promise.all([
          tx.noteDraft.findFirst({
            where: {
              status: 'COMPLETED',
              riskSeverity: { in: ['HIGH', 'CRITICAL'] },
              session: { ...sessionScope, status: 'COMPLETED' },
            },
            // Highest-severity saved context wins; a newer lesser concern must not hide it.
            orderBy: [{ riskSeverity: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
            select: { sessionId: true, riskSeverity: true, updatedAt: true },
          }),
          tx.mindManualNoteDraft.findMany({
            where: {
              encryptedFields: { not: null },
              session: { ...sessionScope, status: { in: ['IN_PROGRESS', 'COMPLETED'] } },
            },
            orderBy: [{ updatedAt: 'desc' }, { sessionId: 'desc' }],
            select: { sessionId: true, encryptedFields: true, updatedAt: true },
          }),
        ]);
        const candidates: ClinicianDocumentedRisk[] = [];
        if (row && (row.riskSeverity === 'HIGH' || row.riskSeverity === 'CRITICAL')) {
          candidates.push({
            severity: row.riskSeverity === 'CRITICAL' ? 'critical' : 'high',
            sourceSessionId: row.sessionId,
            recordedAt: row.updatedAt.toISOString(),
            sourceStatus: 'COMPLETED',
          });
        }
        // There is no score projection for unfinished encrypted drafts. Read every
        // saved draft, not just the latest visits, and never convert it into a report.
        for (const draft of drafts) {
          if (!draft.encryptedFields) continue;
          try {
            const plaintext = await decryptForTenant(client.psychologistId, draft.encryptedFields);
            if (plaintext === null) throw new Error('Unavailable');
            const fields = MindManualNoteFieldsSchema.parse(JSON.parse(plaintext));
            if (fields.riskSeverity === 'high' || fields.riskSeverity === 'critical') {
              candidates.push({
                severity: fields.riskSeverity,
                sourceSessionId: draft.sessionId,
                recordedAt: draft.updatedAt.toISOString(),
                sourceStatus: 'UNFINISHED',
              });
            }
          } catch {
            // Do not render "no flags" when secure safety context could not be read.
            // Never log or expose parser/KMS errors that may contain clinical text.
            throw new Error('Saved clinician safety context could not be securely loaded.');
          }
        }
        return (
          candidates.sort((a, b) => {
            const severityDifference =
              Number(b.severity === 'critical') - Number(a.severity === 'critical');
            return severityDifference || b.recordedAt.localeCompare(a.recordedAt);
          })[0] ?? null
        );
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) return null;
    // Includes transaction/secure-read failure; do not expose raw PHI errors.
    throw new Error('Saved clinician safety context could not be securely loaded.');
  }
}

export function withClinicianRisk<
  T extends { highestSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical'; labels: string[] },
>(crisis: T, documented?: ClinicianDocumentedRisk | null): T {
  if (!documented) return crisis;
  const rank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return {
    ...crisis,
    highestSeverity:
      rank[documented.severity] > rank[crisis.highestSeverity]
        ? documented.severity
        : crisis.highestSeverity,
    labels: [
      ...crisis.labels,
      `Clinician-written ${documented.sourceStatus === 'UNFINISHED' ? 'unfinished draft' : 'note'} records ${documented.severity} risk — review its context`,
    ],
  };
}
