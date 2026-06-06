import Link from 'next/link';
import type { SessionKind } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';

type TabKey =
  | 'notes'
  | 'clinical-brief'
  | 'client'
  | 'transcript'
  | 'session-info'
  | 'mindmap'
  | 'reflection';

interface TabSpec {
  key: TabKey;
  label: string;
  live: boolean;
  sprint?: string;
}

const BASE_TABS: TabSpec[] = [
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
  /// Sprint 19 — INTAKE sessions get intake-flavoured labels and
  /// hide tabs that only make sense once a treatment plan exists.
  sessionKind?: SessionKind;
}

export function SessionWorkspaceTabs({
  sessionId,
  active = 'notes',
  sessionKind = 'TREATMENT',
}: Props) {
  const tabs = tabsForKind(sessionKind);
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="Session sections"
    >
      {tabs.map((t) => {
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
          <Link
            key={t.key}
            href={href}
            className={className}
            aria-current={isActive ? 'page' : undefined}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}

function tabsForKind(kind: SessionKind): TabSpec[] {
  if (kind === 'INTAKE') {
    // Mindmap + reflection-questions are TherapyNoteV1-shaped — they
    // assume SOAP fields the intake note doesn't produce. Hide them
    // until an intake-specific renderer exists.
    return BASE_TABS.filter((t) => t.key !== 'mindmap' && t.key !== 'reflection').map((t) =>
      t.key === 'notes'
        ? { ...t, label: 'Intake Note' }
        : t.key === 'clinical-brief'
          ? { ...t, label: 'Initial Assessment' }
          : t,
    );
  }
  return BASE_TABS;
}
