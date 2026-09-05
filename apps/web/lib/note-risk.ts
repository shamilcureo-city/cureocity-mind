import type { Prisma, NoteRiskSeverity } from '@prisma/client';
import type { RiskSeverity, TherapyNoteV1 } from '@cureocity/contracts';
import { recordCrisisFlag } from '@cureocity/observability/metrics';
import { writeAudit } from './audit';

/** The existing clinical severity scale, shared by batch and live therapy notes. */
export function mapRiskSeverity(severity: RiskSeverity): NoteRiskSeverity {
  const values: Record<RiskSeverity, NoteRiskSeverity> = {
    none: 'NONE',
    low: 'LOW',
    medium: 'MEDIUM',
    high: 'HIGH',
    critical: 'CRITICAL',
  };
  return values[severity];
}

/**
 * Write the existing high/critical risk event atomically with its draft.
 * Call only within the capture path's guarded persistence transaction, so a
 * refused finalization cannot create a crisis event for an uncommitted note.
 */
export async function writeNoteRiskAudit(
  input: {
    sessionId: string;
    psychologistId: string;
    clientId: string;
    riskFlags: TherapyNoteV1['riskFlags'];
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  const severity = mapRiskSeverity(input.riskFlags.severity);
  if (severity !== 'HIGH' && severity !== 'CRITICAL') return;
  await writeAudit(
    {
      actorType: 'SYSTEM',
      action: 'CRISIS_FLAG_RAISED',
      targetType: 'Session',
      targetId: input.sessionId,
      metadata: {
        severity,
        indicators: input.riskFlags.indicators,
        details: input.riskFlags.details ?? null,
        psychologistId: input.psychologistId,
        clientId: input.clientId,
      },
    },
    tx,
  );
}

/** Metrics are best-effort process telemetry; call only after the draft commits. */
export function recordCommittedNoteRisk(severity: NoteRiskSeverity): void {
  if (severity === 'HIGH' || severity === 'CRITICAL') recordCrisisFlag(severity);
}
