'use client';

import { useRouter } from 'next/navigation';
import { useState, type MouseEvent } from 'react';

interface Props {
  /** Client/patient row to archive. */
  clientId: string;
  /** Vertical wording — 'patient' (doctor) or 'client' (therapist). */
  noun?: 'patient' | 'client';
  /** Display name for the confirm copy; empty/undecryptable falls back to a generic phrase. */
  name?: string;
  /**
   * 'button' — the detail-page control: full-width label, navigates to
   *            `redirectTo` after archiving.
   * 'row'    — the roster control: compact, archives in place and refreshes
   *            the list (the archived row filters itself out on re-render).
   */
  variant?: 'button' | 'row';
  /** Where to navigate after archiving (button variant only). */
  redirectTo?: string;
}

/**
 * Archive (soft-delete) control for a patient/client.
 *
 * Calls `DELETE /api/v1/clients/:id`, which sets `deletedAt` so the row
 * drops out of every roster while the record is retained for audit. This
 * is NOT a hard delete and NOT the DPDP erasure path — the confirm copy
 * says so plainly. Two placements: the detail-page button (navigates away)
 * and the compact roster-row control (refreshes the list in place).
 */
export function ArchivePatientButton({
  clientId,
  noun = 'patient',
  name,
  variant = 'button',
  redirectTo,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive(e?: MouseEvent) {
    // On the roster the control sits inside a clickable row — keep the click
    // from bubbling into the row's navigation link.
    e?.preventDefault();
    e?.stopPropagation();
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
        const msg = body.error ?? `Could not archive this ${noun}.`;
        setError(msg);
        if (variant === 'row') alert(msg);
        return;
      }
      if (variant === 'button' && redirectTo) router.push(redirectTo);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={archive}
        disabled={busy}
        aria-label={`Archive ${name?.trim() || `this ${noun}`}`}
        title="Archive — remove from roster (record retained for audit)"
        className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-3)] transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-60"
      >
        {busy ? '…' : 'Archive'}
      </button>
    );
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
