'use client';

import { useState } from 'react';
import type { ProblemListItem } from '@cureocity/contracts';

/**
 * Sprint 67c — the maintained per-client problem list.
 *
 * Active problems up top, resolved ones below. Add a problem, mark it
 * resolved (or reopen it), or remove it. A stable artefact the therapist
 * owns — distinct from the auto-synthesised Case Briefing.
 */
export function ProblemList({
  clientId,
  initialItems,
}: {
  clientId: string;
  initialItems: ProblemListItem[];
}) {
  const [items, setItems] = useState<ProblemListItem[]>(initialItems);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = items.filter((i) => i.status === 'ACTIVE');
  const resolved = items.filter((i) => i.status === 'RESOLVED');

  async function add(): Promise<void> {
    const t = title.trim();
    if (t.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/problems`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        item?: ProblemListItem;
        error?: string;
      };
      if (!res.ok || !data.item) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems((xs) => [data.item as ProblemListItem, ...xs]);
      setTitle('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: ProblemListItem['status']): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/problems/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        item?: ProblemListItem;
        error?: string;
      };
      if (!res.ok || !data.item) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems((xs) => xs.map((x) => (x.id === id ? (data.item as ProblemListItem) : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/problems/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="flex gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a problem — e.g. “Sleep disturbance”, “Conflict at work”"
          className="flex-1 rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={busy || title.trim().length === 0}
          className="rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}

      {active.length === 0 && resolved.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-ink-3)]">
          No problems listed yet. Add the main difficulties you&apos;re working on with this client.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {active.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-line-soft)] bg-white/40 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)]">{p.title}</p>
                {p.detail && <p className="mt-0.5 text-xs text-[var(--color-ink-2)]">{p.detail}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => void setStatus(p.id, 'RESOLVED')}
                  className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-1 font-medium text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  Resolve
                </button>
                <button
                  type="button"
                  onClick={() => void remove(p.id)}
                  aria-label="Remove problem"
                  className="text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Resolved</p>
          <ul className="space-y-2">
            {resolved.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-line-soft)] px-4 py-2.5 opacity-70"
              >
                <p className="min-w-0 text-sm text-[var(--color-ink-2)] line-through">{p.title}</p>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => void setStatus(p.id, 'ACTIVE')}
                    className="font-medium text-[var(--color-ink-3)] hover:text-[var(--color-accent)]"
                  >
                    Reopen
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(p.id)}
                    aria-label="Remove problem"
                    className="text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
