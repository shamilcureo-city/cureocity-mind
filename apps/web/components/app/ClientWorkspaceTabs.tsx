import Link from 'next/link';

export type ClientTabKey = 'record' | 'copilot';

interface Props {
  clientId: string;
  active?: ClientTabKey;
}

const TABS: { key: ClientTabKey; label: string }[] = [
  { key: 'record', label: 'Record' },
  { key: 'copilot', label: 'AI Copilot' },
];

/**
 * Sprint 27 — top-level tab bar on the client page.
 *
 * Mirrors the session page's documentation-vs-copilot split. The
 * **Record** tab is the bare administrative record (identity +
 * sessions + data rights) every therapist needs. The **AI Copilot**
 * tab holds all client-level decision-support (journey, briefing,
 * measures, formulation) — therapists who only want a documentation
 * tool ignore it.
 */
export function ClientWorkspaceTabs({ clientId, active = 'record' }: Props) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="Client sections"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const href = t.key === 'record' ? `/app/clients/${clientId}` : `/app/clients/${clientId}?tab=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? 'border-[var(--color-ink)] font-medium text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
