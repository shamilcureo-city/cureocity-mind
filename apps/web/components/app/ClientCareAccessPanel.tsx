'use client';

import { useState } from 'react';

export function ClientCareAccessPanel({ clientId }: { clientId: string }) {
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/clients/${clientId}/claim-token`, { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { token?: string };
      if (!response.ok || !body.token) throw new Error();
      setClaimUrl(`${window.location.origin}/p/claim/${body.token}`);
    } catch {
      setError('Could not create care access. It may already be claimed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-5 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
      <h2 className="font-serif text-xl">Client care access</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        Issue a single-use link. The client verifies their phone before longitudinal access is
        bound.
      </p>
      {!claimUrl ? (
        <button
          type="button"
          onClick={() => void issue()}
          disabled={busy}
          className="mt-3 rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create care-access link'}
        </button>
      ) : (
        <div className="mt-3 flex gap-2">
          <input
            readOnly
            value={claimUrl}
            className="min-w-0 flex-1 rounded-xl border p-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(claimUrl)}
            className="rounded-full border px-4 text-sm"
          >
            Copy
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
    </div>
  );
}
