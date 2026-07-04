'use client';

import { useState } from 'react';

/**
 * Sprint 73 — tag which problems a session worked on.
 *
 * Toggle chips of the client's active problems; the ones this session
 * advanced are filled. Each toggle PUTs the full set to
 * /api/v1/sessions/[id]/problems (idempotent). Threads a single problem
 * across the case — pair with the "worked on in N sessions" count on the
 * client's problem list.
 */
export function SessionProblemTags({
  sessionId,
  active,
  initialTaggedIds,
}: {
  sessionId: string;
  active: { id: string; title: string }[];
  initialTaggedIds: string[];
}) {
  const [tagged, setTagged] = useState<Set<string>>(new Set(initialTaggedIds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string): Promise<void> {
    const next = new Set(tagged);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const prev = tagged;
    setTagged(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/problems`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ problemIds: [...next] }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setTagged(prev); // revert
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Problems worked on this session
          </h3>
        </div>
        {saving && <span className="text-xs text-[var(--color-ink-3)]">Saving…</span>}
      </div>

      {active.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-ink-3)]">
          No problems on the list yet. Add them from the client&apos;s page to tag what each session
          works on.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            Tap a problem to mark it addressed today — it threads across the case.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.map((p) => {
              const on = tagged.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void toggle(p.id)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <span aria-hidden="true" className="text-xs">
                    {on ? '✓' : '+'}
                  </span>
                  {p.title}
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
    </section>
  );
}
