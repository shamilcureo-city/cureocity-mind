import Link from 'next/link';
import type { SessionKind } from '@cureocity/contracts';

export type TabKey = 'review' | 'note' | 'transcript' | 'details';

interface TabSpec {
  key: TabKey;
  label: string;
}

interface Props {
  sessionId: string;
  active?: TabKey;
  sessionKind?: SessionKind;
}

const TABS: TabSpec[] = [
  { key: 'review', label: 'Session review' },
  { key: 'note', label: 'Note' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'details', label: 'Session details' },
];

/** Mind keeps longitudinal care on the client and visit evidence on the session. */
export function SessionWorkspaceTabs({ sessionId, active = 'review' }: Props) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="Session sections"
    >
      {TABS.map((tab) => {
        const activeTab = tab.key === active;
        const href =
          tab.key === 'review'
            ? `/app/sessions/${sessionId}`
            : `/app/sessions/${sessionId}?tab=${tab.key}`;
        return (
          <Link
            key={tab.key}
            href={href}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              activeTab
                ? 'border-[var(--color-ink)] font-medium text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
            }`}
            aria-current={activeTab ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
