'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';

/**
 * Sprint 67 — cross-note search UI.
 *
 * Type a phrase, get the sessions whose signed notes mention it, each with
 * a short excerpt and a link straight to that session. Debounce-free and
 * simple: search on submit (Enter / button).
 */
interface Result {
  sessionId: string;
  clientId: string;
  clientName: string;
  scheduledAt: string;
  kind: string;
  snippet: string;
}

export function NoteSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/search/notes?q=${encodeURIComponent(q)}`, {
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data.results ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }, [query]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search inside your notes — e.g. “sleep”, “her father”, “panic”"
          className="flex-1 rounded-2xl border border-[var(--color-line)] bg-white px-4 py-3 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={pending || query.trim().length < 2}
          className="rounded-2xl bg-[var(--color-accent)] px-5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-[var(--color-warn)]">{error}</p>}

      {results !== null && (
        <div className="mt-6">
          {results.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-3)]">
              No notes mention “{query.trim()}”. Try a shorter or simpler word.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                {results.length} session{results.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-2">
                {results.map((r) => (
                  <li key={r.sessionId}>
                    <Link
                      href={`/app/sessions/${r.sessionId}`}
                      className="block rounded-2xl border border-[var(--color-line)] bg-white p-4 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--color-ink)]">
                          {r.clientName}
                        </span>
                        <span className="text-xs text-[var(--color-ink-3)]">
                          {r.kind.toLowerCase()} ·{' '}
                          {new Date(r.scheduledAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-2)]">
                        {r.snippet}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
