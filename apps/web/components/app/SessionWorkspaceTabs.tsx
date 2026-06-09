import Link from 'next/link';
import type { SessionKind } from '@cureocity/contracts';

export type TabKey = 'notes' | 'copilot' | 'transcript' | 'session-info' | 'client';

interface TabSpec {
  key: TabKey;
  label: string;
}

interface Props {
  sessionId: string;
  active?: TabKey;
  /// Sprint 19 — INTAKE-aware label tweaks (e.g. "Intake note").
  sessionKind?: SessionKind;
}

/**
 * Sprint 26 — slimmer top-level tab bar.
 *
 * Documentation-flavoured tabs (Notes / Transcript / Session
 * Information / Client) live as peers. All the AI decision-support
 * surfaces (Clinical Brief, Mindmap, Reflection Questions, Therapy
 * Script, Case Briefing, Conceptual Map, Diagnosis history, Therapy
 * Library, Workflow) collapse into a single **AI Copilot** tab that
 * therapists who only want a documentation tool can simply ignore.
 *
 * Inside the AI Copilot tab a smaller sub-tab bar groups the
 * surfaces by altitude: "Briefing" (the synthesis), "This session"
 * (per-session AI outputs), "This client" (cross-session AI
 * surfaces). See `AICopilotSubTabs`.
 */
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
        const href =
          t.key === 'notes' ? `/app/sessions/${sessionId}` : `/app/sessions/${sessionId}?tab=${t.key}`;
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

function tabsForKind(kind: SessionKind): TabSpec[] {
  const base: TabSpec[] = [
    { key: 'notes', label: kind === 'INTAKE' ? 'Intake Note' : 'Notes' },
    { key: 'copilot', label: 'AI Copilot' },
    { key: 'transcript', label: 'Transcript' },
    { key: 'session-info', label: 'Session Information' },
    { key: 'client', label: 'Client' },
  ];
  return base;
}
