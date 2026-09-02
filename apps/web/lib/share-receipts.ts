import type { PatientShareStatus } from '@cureocity/contracts';
import { canOrdinarilyResend } from './sprint5-final-behavior';

export function hasSuccessfulDelivery(rows: readonly { status: PatientShareStatus }[]): boolean {
  return rows.some((row) => row.status === 'SENT' || row.status === 'OPENED');
}

export function receiptActions(receipt: {
  status: PatientShareStatus;
  errorCode?: string | null;
  verifiedNonDeliveryAt?: string | Date | null;
}) {
  return {
    resend: canOrdinarilyResend({
      ...receipt,
      verifiedNonDeliveryAt: receipt.verifiedNonDeliveryAt
        ? new Date(receipt.verifiedNonDeliveryAt)
        : null,
    }),
    revoke: receipt.status === 'SENT' || receipt.status === 'OPENED',
  };
}

export function receiptDisplay(receipt: {
  status: PatientShareStatus;
  createdAt: string;
  sentAt: string | null;
  openedAt: string | null;
  revokedAt: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
}) {
  const labels: Record<PatientShareStatus, string> = {
    PENDING: 'Pending',
    SENT: 'Sent',
    OPENED: 'Opened',
    TRANSIENT_FAILURE: 'Failed',
    PERMANENT_FAILURE: 'Failed',
    REVOKED: 'Revoked',
  };
  return {
    statusLabel: labels[receipt.status],
    occurredAt: receipt.revokedAt ?? receipt.openedAt ?? receipt.sentAt ?? receipt.createdAt,
  };
}
