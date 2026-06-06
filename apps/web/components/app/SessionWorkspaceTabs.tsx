import Link from 'next/link';
import { Badge } from '../ui/Badge';

type TabKey =
  | 'notes'
  | 'clinical-brief'
  | 'client'
  | 'transcript'
  | 'session-info'
  | 'mindmap'
  | 'reflection';

const TABS: { key: TabKey; label: string; live: boolean; sprint?: string }[] = [
  { key: 'notes', label: 'Notes', live: true },
  { key: 'clinical-brief', label: 'Clinical Brief', live: true },
  { key: 'client', label: 'Client', live: true },
  { key: 'transcript', label: 'Transcript', live: true },
  { key: 'session-info', label: 'Session Information', live: true },
  { key: 'mindmap', label: 'Mindmap', live: true },
  { key: 'reflection', label: 'Reflection Questions', live: true },
];

interface Props {
  sessionId: string;
  active?: TabKey;
}

export function SessionWorkspaceTabs({ sessionId, active = 'notes' }: Props) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="Session sections"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const className = `group inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
          isActive
            ? 'border-[var(--color-ink)] font-medium text-[var(--color-ink)]'
            : t.live
              ? 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
              : 'border-transparent text-[var(--color-ink-3)] cursor-not-allowed'
        }`;
        const inner = (
          <>
            {t.label}
            {!t.live && (
              <Badge tone="muted" className="opacity-60">
                {t.sprint}
              </Badge>
            )}
          </>
        );
        if (!t.live) {
          return (
            <button key={t.key} type="button" disabled className={className}>
              {inner}
            </button>
          );
        }
        // The Notes tab is the canonical view — render it without a query param
        // so the URL stays clean for the most common landing case.
        const href =
          t.key === 'notes'
            ? `/app/sessions/${sessionId}`
            : `/app/sessions/${sessionId}?tab=${t.key}`;
        return (
          <Link key={t.key} href={href} className={className} aria-current={isActive ? 'page' : undefined}>
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
