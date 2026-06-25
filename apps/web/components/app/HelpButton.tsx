'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LearnSearch, type SearchTopic, type SearchWord } from './learn/LearnSearch';
import { helpSlugForPath } from '../../lib/route-help-map';

/**
 * Sprint 61 — a persistent "?" help button, reachable from every screen.
 *
 * Tap it to open a small panel with: help for the page you're on (mapped
 * from the route), a search over every topic + word, and a link to the
 * full Learn Center. Calm and out of the way — a single floating button
 * that clears the mobile tab bar.
 */
export function HelpButton({ topics, words }: { topics: SearchTopic[]; words: SearchWord[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '/app';
  const contextualSlug = helpSlugForPath(pathname);
  const contextual = contextualSlug ? topics.find((t) => t.slug === contextualSlug) : undefined;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/10"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      <div className="fixed bottom-20 right-4 z-50 md:bottom-6 md:right-6">
        {open && (
          <div
            role="dialog"
            aria-label="Help"
            className="mb-3 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[var(--color-line)] bg-white p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-serif text-lg">Need a hand?</p>
              <Link
                href="/app/learn"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-[var(--color-accent)] hover:underline"
              >
                Browse all help →
              </Link>
            </div>

            {contextual && (
              <Link
                href={`/app/learn/${contextual.slug}`}
                onClick={() => setOpen(false)}
                className="mb-3 block rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-accent-soft)]/40 px-3.5 py-3 hover:border-[var(--color-accent)]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                  Help for this page
                </p>
                <p className="mt-0.5 text-sm font-medium text-[var(--color-ink)]">
                  {contextual.title} →
                </p>
              </Link>
            )}

            <LearnSearch topics={topics} words={words} />
          </div>
        )}

        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Close help' : 'Open help'}
          onClick={() => setOpen((v) => !v)}
          className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-accent)] text-xl font-semibold text-white shadow-lg transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          {open ? '×' : '?'}
        </button>
      </div>
    </>
  );
}
