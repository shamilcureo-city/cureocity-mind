'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';
import { primeMicPermission } from '@/lib/audio/prime-mic';

/**
 * Sprint DV2 → DS11.3 — "Start consult" for the doctor patient page.
 *
 * Live is the main flow: the primary action creates the session, primes
 * the mic permission on this same gesture, and lands on the live copilot
 * (?flash=1 → Ready screen → auto-start). The caret reveals the
 * deliberate deviations (dictate/record after the visit — the classic
 * batch pipeline). Handles the trial-cap 402 like the therapist flows.
 */
export function StartEncounterButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSession(): Promise<string | null> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, scheduledAt: new Date().toISOString() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not start encounter (${res.status}).`);
      }
      const created = (await res.json()) as { id: string };
      return created.id;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return null;
    }
  }

  async function startLive(): Promise<void> {
    const id = await createSession();
    if (!id) return;
    // Prime the mic on THIS gesture so the live page auto-starts.
    await primeMicPermission();
    router.push(`/app/patients/${clientId}/encounters/${id}/live?flash=1`);
  }

  async function startDictate(): Promise<void> {
    setMenuOpen(false);
    const id = await createSession();
    if (!id) return;
    router.push(`/app/patients/${clientId}/encounters/${id}`);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="relative flex items-stretch">
        <Button
          type="button"
          onClick={() => void startLive()}
          disabled={busy}
          className="rounded-r-none"
        >
          {busy ? 'Starting…' : '● Start live consult'}
        </Button>
        <Button
          type="button"
          aria-label="More capture modes"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          disabled={busy}
          className="rounded-l-none border-l border-white/25 px-2.5"
        >
          ▾
        </Button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-[var(--color-line)] bg-white shadow-lg">
            <button
              type="button"
              onClick={() => void startDictate()}
              className="block w-full px-4 py-3 text-left hover:bg-[var(--color-surface-soft)]"
            >
              <span className="block text-sm font-medium text-[var(--color-ink)]">
                🗣 Dictate / record after visit
              </span>
              <span className="block text-xs text-[var(--color-ink-3)]">
                You summarise or record; the note drafts from the audio.
              </span>
            </button>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}
    </div>
  );
}
