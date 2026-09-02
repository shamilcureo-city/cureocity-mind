import { describe, expect, it } from 'vitest';
import { receiptActions, receiptDisplay, hasSuccessfulDelivery } from './share-receipts';

describe('Sprint 5.2 durable share receipts', () => {
  it('shows durable status and timestamps without exposing provider errors', () => {
    expect(
      receiptDisplay({
        status: 'PERMANENT_FAILURE',
        createdAt: '2026-09-01T01:00:00.000Z',
        sentAt: null,
        openedAt: null,
        revokedAt: null,
        errorCode: 'SENDGRID_403',
        errorDetail: 'recipient alice@example.com rejected',
      }),
    ).toEqual({ statusLabel: 'Failed', occurredAt: '2026-09-01T01:00:00.000Z' });
  });

  it('allows resend only for verified failures and revoke only for active delivery', () => {
    expect(
      receiptActions({
        status: 'TRANSIENT_FAILURE',
        errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
        verifiedNonDeliveryAt: null,
      }),
    ).toEqual({ resend: false, revoke: false });
    expect(
      receiptActions({
        status: 'TRANSIENT_FAILURE',
        errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
        verifiedNonDeliveryAt: '2026-09-01T01:00:00.000Z',
      }),
    ).toEqual({ resend: true, revoke: false });
    expect(receiptActions({ status: 'PERMANENT_FAILURE' })).toEqual({
      resend: true,
      revoke: false,
    });
    expect(receiptActions({ status: 'SENT' })).toEqual({ resend: false, revoke: true });
    expect(receiptActions({ status: 'OPENED' })).toEqual({ resend: false, revoke: true });
    expect(receiptActions({ status: 'REVOKED' })).toEqual({ resend: false, revoke: false });
  });

  it.each([
    { status: 'TRANSIENT_FAILURE' as const, errorCode: null },
    { status: 'PERMANENT_FAILURE' as const, errorCode: 'BOUNCE' },
    { status: 'SENT' as const },
    { status: 'OPENED' as const },
  ])('never offers resend and revoke for the same receipt: $status', (receipt) => {
    const actions = receiptActions(receipt);
    expect(actions.resend && actions.revoke).toBe(false);
  });

  it('does not treat an HTTP 200 containing only failures as successful delivery', () => {
    expect(hasSuccessfulDelivery([{ status: 'PERMANENT_FAILURE' }])).toBe(false);
    expect(hasSuccessfulDelivery([{ status: 'SENT' }])).toBe(true);
  });
});
