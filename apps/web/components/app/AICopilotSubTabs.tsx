import Link from 'next/link';

export type CopilotSubKey = 'session' | 'journey' | 'briefing' | 'measures' | 'formulation';

interface Props {
  sessionId: string;
  active?: CopilotSubKey;
}

const TABS: { key: CopilotSubKey; label: string; hint: string }[] = [
  { key: 'session', label: 'This session', hint: "This recording's AI analysis" },
  { key: 'journey', label: 'Journey', hint: 'Where they are, what to do next' },
  { key: 'briefing', label: 'Case Briefing', hint: 'The cross-session synthesis' },
  { key: 'measures', label: 'Measures', hint: 'Instruments + affect trend' },
  { key: 'formulation', label: 'Formulation & Plan', hint: 'Map, diagnosis, therapies' },
];

/**
 * Sprint 28 — secondary tab bar inside the session AI Copilot tab.
 *
 * The session AI Copilot is now the *full* copilot: "This session"
 * (this recording's analysis) sits alongside the cross-session
 * decision-support (Journey, Case Briefing, Measures, Formulation &
 * Plan). Smaller/lighter than the top-level `SessionWorkspaceTabs`
 * so the two levels don't compete. URL: `?tab=copilot&sub=…`,
 * defaulting to `session`.
 */
export function AICopilotSubTabs({ sessionId, active = 'session' }: Props) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="AI Copilot sections"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const href = `/app/sessions/${sessionId}?tab=copilot&sub=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            className={`inline-flex flex-col items-start border-b-2 px-3 py-2 text-xs transition-colors ${
              isActive
                ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="text-sm font-medium">{t.label}</span>
            <span className="text-[10px] text-[var(--color-ink-3)]">{t.hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
