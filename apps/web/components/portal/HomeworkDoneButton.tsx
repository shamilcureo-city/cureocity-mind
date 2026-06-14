'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sprint 51 — portal "Mark as done" button.
 *
 * Sits inside the THERAPY_SCRIPT snapshot's "Between sessions" card on
 * the patient portal. POSTs to /api/v1/p/[token]/homework — the token
 * IS the auth (same trust model as the S47 check-in submit). On
 * success, refreshes the portal page so the snapshot's
 * `homeworkCompleted` flag (just flipped server-side) renders the
 * thank-you state. 409 means somebody already marked it (a re-send
 * across channels can land in either order).
 */
export function HomeworkDoneButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/p/${token}/homework`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Could not mark done (HTTP ${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Mark as done'}
      </button>
      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
    </div>
  );
}
