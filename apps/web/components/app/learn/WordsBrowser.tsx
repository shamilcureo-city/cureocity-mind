'use client';

import { useMemo, useState } from 'react';

/**
 * Sprint 60 — the browsable "Words explained" list.
 *
 * Renders every glossary entry as a calm, readable card with an anchor id
 * (`word-<key>`) so search results can deep-link straight to a word. A
 * filter box trims the list as you type. Client-side only — the glossary
 * is small and static.
 */

export interface WordEntry {
  key: string;
  plainTitle: string;
  term: string | undefined;
  what: string;
  why: string | undefined;
  example: string | undefined;
}

export function WordsBrowser({ words }: { words: WordEntry[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q.length === 0
        ? words
        : words.filter((w) =>
            `${w.plainTitle} ${w.term ?? ''} ${w.what}`.toLowerCase().includes(q),
          ),
    [q, words],
  );

  return (
    <div>
      <label className="relative mb-6 block max-w-md">
        <span className="sr-only">Filter words</span>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-ink-3)]">
          ⌕
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter — e.g. “mood”, “plan”, “safety”"
          className="w-full rounded-2xl border border-[var(--color-line)] bg-white py-3 pl-10 pr-4 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
        />
      </label>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-3)]">Nothing matched “{query}”.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((w) => (
            <li
              key={w.key}
              id={`word-${w.key}`}
              className="scroll-mt-6 rounded-2xl border border-[var(--color-line-soft)] bg-white p-5"
            >
              <p className="font-serif text-lg text-[var(--color-ink)]">{w.plainTitle}</p>
              {w.term && (
                <p className="mt-0.5 text-xs uppercase tracking-wider text-[var(--color-ink-3)]">
                  {w.term}
                </p>
              )}
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink)]">{w.what}</p>
              {w.why && (
                <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                  <span className="font-medium text-[var(--color-ink)]">Why it helps · </span>
                  {w.why}
                </p>
              )}
              {w.example && (
                <p className="mt-2 text-sm italic text-[var(--color-ink-3)]">
                  For example: {w.example}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
