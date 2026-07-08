'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaptureMode } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { primeMicPermission } from '@/lib/audio/prime-mic';

/**
 * Sprint DV2 → DS11.3 → DS11.7-fu — "Start consult" for the doctor patient
 * page.
 *
 * Live is the product default: the primary action creates the session, primes
 * the mic permission on this same gesture, and lands on the live copilot
 * (?flash=1 → Ready screen → auto-start). The caret reveals the deliberate
 * deviations (dictate/upload — the classic batch pipeline).
 *
 * DS11.7-fu — a doctor can set a preferred capture mode in Preferences; when
 * they have, that mode becomes the primary button and the other two move into
 * the caret. Every mode stays reachable — the setting only changes the
 * default, never removes a path. Handles the trial-cap 402 like the therapist
 * flows.
 */
type Mode = CaptureMode; // 'LIVE' | 'DICTATE' | 'UPLOAD'

const MODE_META: Record<Mode, { primaryLabel: string; menuLabel: string; menuDesc: string }> = {
  LIVE: {
    primaryLabel: '● Start live consult',
    menuLabel: '🎙 Live consult',
    menuDesc: 'The note writes itself as you talk.',
  },
  DICTATE: {
    primaryLabel: '🗣 Start dictation',
    menuLabel: '🗣 Dictate / record after visit',
    menuDesc: 'You summarise or record; the note drafts from the audio.',
  },
  UPLOAD: {
    primaryLabel: '📁 Upload a recording',
    menuLabel: '📁 Upload a recording',
    menuDesc: 'Recorded on your phone? Upload the audio file.',
  },
};

// The caret shows the two modes other than the primary, in a stable order.
const MODE_ORDER: Mode[] = ['LIVE', 'DICTATE', 'UPLOAD'];

export function StartEncounterButton({
  clientId,
  defaultMode,
}: {
  clientId: string;
  /** DS11.7-fu — the doctor's preferred capture mode; absent/null = LIVE. */
  defaultMode?: CaptureMode | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primary: Mode = defaultMode ?? 'LIVE';
  const secondary = MODE_ORDER.filter((m) => m !== primary);

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

  async function go(mode: Mode): Promise<void> {
    setMenuOpen(false);
    const id = await createSession();
    if (!id) return;
    const base = `/app/patients/${clientId}/encounters/${id}`;
    if (mode === 'LIVE') {
      // Prime the mic on THIS gesture so the live page auto-starts.
      await primeMicPermission();
      router.push(`${base}/live?flash=1`);
    } else if (mode === 'UPLOAD') {
      router.push(`${base}?mode=upload`);
    } else {
      router.push(base);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="relative flex items-stretch">
        <Button
          type="button"
          onClick={() => void go(primary)}
          disabled={busy}
          className="rounded-r-none"
        >
          {busy ? 'Starting…' : MODE_META[primary].primaryLabel}
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
            {secondary.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => void go(m)}
                className={`block w-full px-4 py-3 text-left hover:bg-[var(--color-surface-soft)] ${
                  i > 0 ? 'border-t border-[var(--color-line-soft)]' : ''
                }`}
              >
                <span className="block text-sm font-medium text-[var(--color-ink)]">
                  {MODE_META[m].menuLabel}
                </span>
                <span className="block text-xs text-[var(--color-ink-3)]">
                  {MODE_META[m].menuDesc}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}
    </div>
  );
}
