'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BillingAccountStatus } from '@cureocity/contracts';

/**
 * Sprint 56 (Lever 4 #4) — self-serve plan management on the Plan page.
 *
 * ACTIVE paid  → Pause | Cancel (Cancel nudges Pause first — the
 *                retention play).
 * PAUSED       → Resume (shows banked days).
 * CANCELLED    → Reactivate (won't-renew accounts that still have access).
 */
interface Props {
  status: BillingAccountStatus;
  pausedRemainingDays: number | null;
}

type Action = 'pause' | 'resume' | 'cancel';

export function PlanManageButtons({ status, pausedRemainingDays }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/v1/billing/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setConfirmCancel(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const secondary =
    'rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)] disabled:opacity-60';
  const primary =
    'rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60';

  return (
    <div className="mt-4">
      {status === 'PAUSED' && (
        <button
          type="button"
          className={primary}
          disabled={busy !== null}
          onClick={() => run('resume')}
        >
          {busy === 'resume'
            ? 'Resuming…'
            : `Resume plan${pausedRemainingDays !== null ? ` (${pausedRemainingDays} days banked)` : ''}`}
        </button>
      )}

      {status === 'CANCELLED' && (
        <button
          type="button"
          className={primary}
          disabled={busy !== null}
          onClick={() => run('resume')}
        >
          {busy === 'resume' ? 'Reactivating…' : 'Reactivate plan'}
        </button>
      )}

      {status === 'ACTIVE' && !confirmCancel && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondary}
            disabled={busy !== null}
            onClick={() => run('pause')}
          >
            {busy === 'pause' ? 'Pausing…' : 'Pause plan'}
          </button>
          <button
            type="button"
            className={secondary}
            disabled={busy !== null}
            onClick={() => setConfirmCancel(true)}
          >
            Cancel plan
          </button>
        </div>
      )}

      {status === 'ACTIVE' && confirmCancel && (
        <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            Before you cancel — you can <strong>pause</strong> instead and keep your remaining paid
            days banked for whenever you come back. Cancelling keeps access until your plan lapses,
            then drops you to the free trial.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy !== null}
              onClick={() => run('pause')}
            >
              {busy === 'pause' ? 'Pausing…' : 'Pause instead'}
            </button>
            <button
              type="button"
              className={secondary}
              disabled={busy !== null}
              onClick={() => run('cancel')}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel anyway'}
            </button>
            <button
              type="button"
              className="px-2 py-2 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
              disabled={busy !== null}
              onClick={() => setConfirmCancel(false)}
            >
              Keep my plan
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
    </div>
  );
}
