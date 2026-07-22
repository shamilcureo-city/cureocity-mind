'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface WaitlistEntry {
  id: string;
  contact: string;
  createdAt: string;
  invitedAt: string | null;
}

/**
 * PC2 — the Care waitlist manager. Invite (marks invitedAt, keeps the row)
 * or remove an entry, each posting to an admin-gated route that writes an
 * audit row. Optimistic with rollback.
 */
export function CareWaitlistManager({ entries }: { entries: WaitlistEntry[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<WaitlistEntry[]>(entries);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(id: string): Promise<void> {
    setBusy(id);
    setError(null);
    const prev = rows;
    const at = new Date().toISOString();
    setRows((r) => r.map((e) => (e.id === id ? { ...e, invitedAt: at } : e)));
    const res = await fetch(`/api/v1/admin/care-waitlist/${id}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res || !res.ok) {
      setRows(prev);
      setError('Could not mark invited — try again.');
    } else {
      router.refresh();
    }
    setBusy(null);
  }

  async function remove(id: string): Promise<void> {
    setBusy(id);
    setError(null);
    const prev = rows;
    setRows((r) => r.filter((e) => e.id !== id));
    const res = await fetch(`/api/v1/admin/care-waitlist/${id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (!res || !res.ok) {
      setRows(prev);
      setError('Could not remove — try again.');
    } else {
      router.refresh();
    }
    setBusy(null);
  }

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-ink-3)]">The Care waitlist is empty.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-3)]">
              <th className="pb-2 font-medium">Contact</th>
              <th className="pb-2 font-medium">Joined</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-[var(--color-line-soft)]">
                <td className="py-2.5 font-mono text-xs">{e.contact}</td>
                <td className="py-2.5 text-xs text-[var(--color-ink-3)]">
                  {new Date(e.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>
                <td className="py-2.5">
                  {e.invitedAt ? (
                    <span className="inline-flex items-center rounded-full bg-[var(--color-good-soft,#E9F5EF)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-good,#0E7A4A)]">
                      invited
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                      waiting
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <div className="inline-flex gap-1.5">
                    {!e.invitedAt && (
                      <button
                        type="button"
                        disabled={busy === e.id}
                        onClick={() => void invite(e.id)}
                        className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-medium hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
                      >
                        {busy === e.id ? '…' : 'Mark invited'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === e.id}
                      onClick={() => void remove(e.id)}
                      className="rounded-full border border-transparent px-2 py-1 text-xs text-[var(--color-ink-3)] hover:text-[var(--color-danger,#B42318)] disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
      <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
        &ldquo;Mark invited&rdquo; records the decision (audited) — sending the actual invite
        message is a follow-up. Removing is permanent.
      </p>
    </div>
  );
}
