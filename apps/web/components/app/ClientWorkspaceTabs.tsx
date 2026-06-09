import Link from 'next/link';

export type ClientTabKey = 'clinical' | 'map' | 'progress' | 'sessions';

interface TabSpec {
  key: ClientTabKey;
  label: string;
  /** Optional small badge — a dot ("•") or icon ("↻") drawn next to the label. */
  badge?: string | null;
}

interface Props {
  clientId: string;
  active?: ClientTabKey;
  /** Per-tab freshness flags. Computed server-side from cheap recency checks. */
  badges?: Partial<Record<ClientTabKey, string | null>>;
}

const BASE_TABS: { key: ClientTabKey; label: string }[] = [
  { key: 'clinical', label: 'Clinical Engine' },
  { key: 'map', label: 'Conceptual Map' },
  { key: 'progress', label: 'Progress' },
  { key: 'sessions', label: 'Sessions' },
];

/**
 * Sprint 25 — peer-tab navigation at the client workspace level.
 *
 * Mirrors `SessionWorkspaceTabs.tsx` so the two surfaces feel like
 * the same product. Clinical Engine is the default landing — its
 * URL is the bare `/app/clients/<id>` (no `?tab=…`).
 *
 * Tab badges are tiny ● / ↻ glyphs from absolute-recency heuristics
 * computed by the page (see `apps/web/app/app/clients/[id]/page.tsx`):
 * a new completed session in the last 24h, a stale conceptual map,
 * or a new running-differential item.
 */
export function ClientWorkspaceTabs({ clientId, active = 'clinical', badges = {} }: Props) {
  const tabs: TabSpec[] = BASE_TABS.map((t) => ({
    ...t,
    badge: badges[t.key] ?? null,
  }));
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="Client sections"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const href =
          t.key === 'clinical'
            ? `/app/clients/${clientId}`
            : `/app/clients/${clientId}?tab=${t.key}`;
        const className = `group inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
          isActive
            ? 'border-[var(--color-ink)] font-medium text-[var(--color-ink)]'
            : 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
        }`;
        return (
          <Link
            key={t.key}
            href={href}
            className={className}
            aria-current={isActive ? 'page' : undefined}
          >
            {t.label}
            {t.badge && (
              <span
                aria-hidden
                className="text-xs leading-none text-[var(--color-accent)]"
                title={t.badge === '●' ? 'new' : 'refresh suggested'}
              >
                {t.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
