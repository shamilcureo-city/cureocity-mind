'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PatientShareStatus } from '@cureocity/contracts';
import { receiptActions } from '@/lib/share-receipts';

export interface ShareReceiptView {
  id: string;
  subject: string;
  artefactType: string;
  channel: string;
  status: PatientShareStatus;
  createdAt: string;
  sentAt: string | null;
  openedAt: string | null;
  revokedAt: string | null;
  errorCode?: string | null;
  verifiedNonDeliveryAt?: string | null;
  expiresAt?: string;
  refreshRequestedAt?: string | null;
}
export function ShareReceiptList({ receipts }: { receipts: ShareReceiptView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(id: string, action: 'resend' | 'revoke') {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/shares/${id}/${action}`, { method: 'POST' });
      if (!response.ok) {
        setError(`Could not ${action} this share. Please try again.`);
        return;
      }
      router.refresh();
    } catch {
      setError(`Could not ${action} this share. Check your connection and try again.`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      {error && (
        <p className="m-4 rounded-xl bg-[var(--color-warn-soft)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      <ul className="divide-y divide-[var(--color-line-soft)]">
        {receipts.map((receipt) => {
          const actions = receiptActions(receipt);
          const canRefresh =
            !!receipt.refreshRequestedAt &&
            !!receipt.expiresAt &&
            new Date(receipt.expiresAt).getTime() <= Date.now() &&
            (receipt.status === 'SENT' || receipt.status === 'OPENED');
          return (
            <li key={receipt.id} className="px-5 py-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-medium">{receipt.subject}</p>
                  <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                    {receipt.artefactType.replace(/_/g, ' ').toLowerCase()} ·{' '}
                    {receipt.channel.toLowerCase()} · {receipt.status.toLowerCase()}
                  </p>
                  <p className="text-xs">
                    Attempted {new Date(receipt.createdAt).toLocaleString('en-IN')}
                  </p>
                  {receipt.status.endsWith('FAILURE') && (
                    <p className="text-xs text-[var(--color-warn)]">
                      Delivery failed
                      {receipt.errorCode === 'CHANNEL_NOT_CONFIGURED'
                        ? ' because this channel is not configured'
                        : ''}
                      .
                    </p>
                  )}
                  {receipt.sentAt && (
                    <p className="text-xs">
                      Sent {new Date(receipt.sentAt).toLocaleString('en-IN')}
                    </p>
                  )}
                  {receipt.openedAt && (
                    <p className="text-xs">
                      Opened {new Date(receipt.openedAt).toLocaleString('en-IN')}
                    </p>
                  )}
                  {receipt.revokedAt && (
                    <p className="text-xs">
                      Revoked {new Date(receipt.revokedAt).toLocaleString('en-IN')}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {(actions.resend || canRefresh) && (
                    <button
                      disabled={busy === receipt.id}
                      onClick={() => void act(receipt.id, 'resend')}
                      className="text-sm text-[var(--color-accent)]"
                    >
                      {canRefresh ? 'Send fresh link' : 'Resend'}
                    </button>
                  )}
                  {actions.revoke && (
                    <button
                      disabled={busy === receipt.id}
                      onClick={() => void act(receipt.id, 'revoke')}
                      className="text-sm text-[var(--color-warn)]"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
