'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';

/**
 * Sprint DV2 — "Start encounter" for the doctor patient page.
 *
 * Creates a SCHEDULED Session row via the existing session-create API
 * (a doctor encounter reuses the Session model; modality is left null by
 * the session-defaults doctor branch). DV2 stops here — recording + the
 * live medical note land in DV3/DV4 — so on success we just refresh the
 * page to show the new encounter in the list.
 *
 * Handles the trial-cap 402 the same way the therapist creation flows
 * do: surface the message with a link to the plan page.
 */
export function StartEncounterButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
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
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" onClick={start} disabled={busy}>
        {busy ? 'Starting…' : '+ Start encounter'}
      </Button>
      {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}
    </div>
  );
}
