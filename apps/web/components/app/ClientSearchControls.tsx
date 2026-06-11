'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Sprint 44 — search + status filter for the client list.
 *
 * Drives the list via URL params (`?q=`, `?status=`) so the page stays
 * a server component and the filter survives refresh / share. Typing
 * is debounced into the URL; switching status or searching resets the
 * pagination cursor.
 */

const STATUS_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PAUSED', label: 'Paused' },
  { key: 'DISCHARGED', label: 'Discharged' },
  { key: 'TRANSFERRED', label: 'Transferred' },
] as const;

export function ClientSearchControls() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(params.get('q') ?? '');
  const activeStatus = params.get('status') ?? 'ALL';

  // Debounce the query into the URL. Resets the pagination cursor so a
  // new search starts from the first page.
  useEffect(() => {
    const current = params.get('q') ?? '';
    if (q.trim() === current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set('q', q.trim());
      else next.delete('q');
      next.delete('cursor');
      startTransition(() => router.replace(`${pathname}?${next.toString()}`));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, params, pathname, router]);

  function selectStatus(key: string) {
    const next = new URLSearchParams(params.toString());
    if (key === 'ALL') next.delete('status');
    else next.set('status', key);
    next.delete('cursor');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search clients by name…"
        aria-label="Search clients by name"
        className="w-full rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] focus:outline-none sm:max-w-xs"
      />
      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => {
          const active = activeStatus === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectStatus(t.key)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
                  : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink)]'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
