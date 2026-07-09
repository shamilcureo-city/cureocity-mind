'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  /** Client/patient row to archive. */
  clientId: string;
  /** Where to send the user after a successful archive. */
  redirectTo: string;
  /** Vertical wording — 'patient' (doctor) or 'client' (therapist). */
  noun?: 'patient' | 'client';
  /** Display name for the confirm copy; empty/undecryptable falls back to a generic phrase. */
  name?: string;
}

/**
 * Archive (soft-delete) control for a patient/client.
 *
 * Calls `DELETE /api/v1/clients/:id`, which sets `deletedAt` so the row
 * drops out of every roster while the record is retained for audit. This
 * is NOT a hard delete and NOT the DPDP erasure path — the confirm copy
 * says so plainly. Mirrors the `DemoClientButton` idiom (confirm → fetch
 * → router.push + refresh).
 */
export function ArchivePatientButton({ clientId, redirectTo, noun = 'patient', name }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    const who = name?.trim() ? `“${name.trim()}”` : `this ${noun}`;
    if (
      !confirm(
        `Archive ${who}? They will be removed from your roster. Encounters and notes are retained (not deleted) for audit — this is not a permanent erasure.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Could not archive this ${noun}.`);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-3)] transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-60"
        onClick={archive}
        disabled={busy}
      >
        {busy ? 'Archiving…' : `Archive ${noun}`}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
