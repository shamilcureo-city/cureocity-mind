'use client';

import { Badge } from '../ui/Badge';

const TABS = [
  { key: 'notes', label: 'Notes', live: true },
  { key: 'client', label: 'Client', live: false, sprint: 'Sprint 3' },
  { key: 'transcript', label: 'Transcript', live: false, sprint: 'Sprint 3' },
  { key: 'session-info', label: 'Session Information', live: false, sprint: 'Sprint 3' },
  { key: 'mindmap', label: 'Mindmap', live: false, sprint: 'Sprint 5' },
  { key: 'reflection', label: 'Reflection Questions', live: false, sprint: 'Sprint 5' },
] as const;

interface Props {
  active?: 'notes' | 'client' | 'transcript' | 'session-info' | 'mindmap' | 'reflection';
}

export function SessionWorkspaceTabs({ active = 'notes' }: Props) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="Session sections"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            disabled={!t.live}
            className={`group inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? 'border-[var(--color-ink)] font-medium text-[var(--color-ink)]'
                : t.live
                  ? 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                  : 'border-transparent text-[var(--color-ink-3)] cursor-not-allowed'
            }`}
          >
            {t.label}
            {!t.live && (
              <Badge tone="muted" className="opacity-60">
                {t.sprint}
              </Badge>
            )}
          </button>
        );
      })}
    </nav>
  );
}
