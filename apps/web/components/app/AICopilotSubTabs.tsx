import Link from 'next/link';

export type CopilotSubKey = 'briefing' | 'session' | 'client';

interface Props {
  sessionId: string;
  active?: CopilotSubKey;
}

const TABS: { key: CopilotSubKey; label: string; hint: string }[] = [
  { key: 'briefing', label: 'Case Briefing', hint: "What's going on, what to do next" },
  { key: 'session', label: 'This session', hint: 'AI analysis of this recording' },
  { key: 'client', label: 'This client', hint: 'Cross-session AI surfaces' },
];

/**
 * Sprint 26 — secondary tab bar inside the AI Copilot tab.
 *
 * Smaller and lighter than the top-level `SessionWorkspaceTabs` so
 * the two levels don't compete visually. URL: `?tab=copilot&sub=…`.
 * Defaulting to `briefing` keeps the bare `?tab=copilot` deep-link
 * meaningful.
 */
export function AICopilotSubTabs({ sessionId, active = 'briefing' }: Props) {
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
