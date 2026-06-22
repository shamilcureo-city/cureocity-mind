'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * Sprint 60 — instant, client-side search over the Learn Center.
 *
 * The content is small and static, so the whole index ships as props and
 * filtering happens in the browser — no backend, no latency. Searches
 * topic titles + summaries and glossary words together, grouped in the
 * results. When the box is empty it renders nothing, so the hub shows its
 * normal browse layout underneath.
 */

export interface SearchTopic {
  slug: string;
  title: string;
  lede: string;
  groupTitle: string;
}

export interface SearchWord {
  key: string;
  plainTitle: string;
  term: string | undefined;
  what: string;
}

function matches(haystack: string, q: string): boolean {
  return haystack.toLowerCase().includes(q);
}

export function LearnSearch({ topics, words }: { topics: SearchTopic[]; words: SearchWord[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const topicHits = useMemo(
    () =>
      q.length < 2
        ? []
        : topics.filter((t) => matches(`${t.title} ${t.lede} ${t.groupTitle}`, q)).slice(0, 8),
    [q, topics],
  );
  const wordHits = useMemo(
    () =>
      q.length < 2
        ? []
        : words.filter((w) => matches(`${w.plainTitle} ${w.term ?? ''} ${w.what}`, q)).slice(0, 8),
    [q, words],
  );

  const showResults = q.length >= 2;
  const empty = showResults && topicHits.length === 0 && wordHits.length === 0;

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search help</span>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-ink-3)]">
          ⌕
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — e.g. “SOAP”, “consent”, “PHQ-9”"
          className="w-full rounded-2xl border border-[var(--color-line)] bg-white py-3 pl-10 pr-4 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)]"
        />
      </label>

      {showResults && (
        <div className="mt-3 rounded-2xl border border-[var(--color-line-soft)] bg-white p-3">
          {empty && (
            <p className="px-2 py-3 text-sm text-[var(--color-ink-3)]">
              Nothing matched “{query}”. Try a simpler word, or browse the topics below.
            </p>
          )}

          {topicHits.length > 0 && (
            <div className="mb-2">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Topics
              </p>
              <ul>
                {topicHits.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/app/learn/${t.slug}`}
                      className="block rounded-xl px-2 py-2 hover:bg-[var(--color-surface-soft)]"
                    >
                      <span className="text-sm font-medium text-[var(--color-ink)]">{t.title}</span>
                      <span className="ml-2 text-xs text-[var(--color-ink-3)]">{t.groupTitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {wordHits.length > 0 && (
            <div>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Words explained
              </p>
              <ul>
                {wordHits.map((w) => (
                  <li key={w.key}>
                    <Link
                      href={`/app/learn/words#word-${w.key}`}
                      className="block rounded-xl px-2 py-2 hover:bg-[var(--color-surface-soft)]"
                    >
                      <span className="text-sm font-medium text-[var(--color-ink)]">
                        {w.plainTitle}
                      </span>
                      {w.term && (
                        <span className="ml-2 text-xs text-[var(--color-ink-3)]">{w.term}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
