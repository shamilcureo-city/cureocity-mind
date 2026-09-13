import { createHash } from 'node:crypto';
import {
  canonicalSessionUsagePayload,
  SessionUsageReceiptSchema,
  type SessionUsageReceipt,
} from '@cureocity/contracts';

export function sessionUsageHash(receipt: SessionUsageReceipt): string {
  return createHash('sha256').update(canonicalSessionUsagePayload(receipt)).digest('hex');
}

export interface StoredSessionUsage {
  connectionId: string;
  sessionId: string;
  psychologistId: string;
  vertical: string;
  backend: string;
  startedAt: Date;
  endedAt: Date | null;
  state: string;
  lastSequence: number;
  lastReceipt: unknown;
  lastPayloadHash: string | null;
  costInr: { toFixed(places: number): string } | string | null;
}

/** Corrupt or partial storage must never become an apparently free connection. */
export function validateStoredSessionUsage(row: StoredSessionUsage): SessionUsageReceipt | null {
  const invalid = () => {
    throw new Error('Stored usage receipt is inconsistent');
  };
  if (
    !['THERAPIST', 'DOCTOR'].includes(row.vertical) ||
    !['vertex', 'mock'].includes(row.backend) ||
    !Number.isFinite(row.startedAt.getTime())
  )
    return invalid();
  if (row.lastReceipt === null) {
    if (
      row.lastSequence !== 0 ||
      row.lastPayloadHash !== null ||
      row.costInr !== null ||
      row.state !== 'OPEN' ||
      row.endedAt !== null
    )
      return invalid();
    return null;
  }
  const receipt = SessionUsageReceiptSchema.parse(row.lastReceipt);
  const cost = typeof row.costInr === 'string' ? row.costInr : row.costInr?.toFixed(4);
  if (
    receipt.connectionId !== row.connectionId ||
    receipt.sessionId !== row.sessionId ||
    receipt.psychologistId !== row.psychologistId ||
    receipt.vertical !== row.vertical ||
    receipt.sequence !== row.lastSequence ||
    receipt.state !== row.state ||
    receipt.endedAt !== (row.endedAt?.toISOString() ?? null) ||
    (row.endedAt !== null && row.endedAt < row.startedAt) ||
    receipt.totals.costInr !== cost ||
    sessionUsageHash(receipt) !== row.lastPayloadHash ||
    (row.backend === 'mock') !== (receipt.usageBasis === 'MOCK_ZERO')
  )
    return invalid();
  return receipt;
}
