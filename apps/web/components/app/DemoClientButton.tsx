'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  /** Existing demo client id, or null if none has been seeded yet. */
  demoClientId: string | null;
  /** Visual variant — 'cta' for the checklist row, 'inline' for action bars. */
  variant?: 'cta' | 'inline';
}

/**
 * Sprint 48 — Demo showcase client control.
 *
 * Renders three states depending on whether the calling therapist
 * already has a demo client seeded:
 *   - no demo client     -> "Create example client" (POST)
 *   - demo exists, cta   -> "Open example client" (navigate)
 *   - demo exists,inline -> "Remove example client" (DELETE) — used
 *     on the demo client's own page so the therapist can clear the
 *     fixture once they have seen it.
 */
export function DemoClientButton({ demoClientId, variant = 'cta' }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/onboarding/demo-client', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not seed the example client.');
        return;
      }
      const body = (await res.json()) as { clientId: string };
      router.push(`/app/clients/${body.clientId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!demoClientId) return;
    if (!confirm('Remove the example client and every fabricated row? This cannot be undone.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/onboarding/demo-client', { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not remove the example client.');
        return;
      }
      router.push('/app');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const baseBtn =
    'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60';

  if (variant === 'inline') {
    if (!demoClientId) {
      return (
        <button
          type="button"
          className={`${baseBtn} bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover,_var(--color-accent))]`}
          onClick={create}
          disabled={busy}
        >
          {busy ? 'Seeding…' : 'Create example client'}
        </button>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${baseBtn} border border-[var(--color-line)] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]`}
          onClick={remove}
          disabled={busy}
        >
          {busy ? 'Removing…' : 'Remove example client'}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  // CTA variant — the FirstRunChecklist row uses this.
  if (demoClientId) {
    return (
      <a
        href={`/app/clients/${demoClientId}`}
        className="self-center text-xs font-medium text-[var(--color-accent)] hover:underline"
      >
        Open →
      </a>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="self-center text-xs font-medium text-[var(--color-accent)] hover:underline disabled:opacity-60"
        onClick={create}
        disabled={busy}
      >
        {busy ? 'Seeding…' : 'Seed it →'}
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
