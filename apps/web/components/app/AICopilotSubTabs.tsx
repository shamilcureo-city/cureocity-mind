import Link from 'next/link';

export type CopilotSubKey = 'session' | 'journey' | 'plan';

interface Props {
  sessionId: string;
  active?: CopilotSubKey;
}

const TABS: { key: CopilotSubKey; label: string; hint: string }[] = [
  { key: 'session', label: 'This session', hint: "This recording's decision board" },
  { key: 'journey', label: 'Journey', hint: 'Where they are · is it working · what next' },
  { key: 'plan', label: 'Plan & toolkit', hint: 'Plan, diagnosis history, map, library' },
];

/**
 * Sprint 28 → Sprint TSC-V2 — secondary tab bar inside the AI Copilot tab.
 *
 * The five altitude tabs collapsed to three that match how a psychologist
 * actually thinks: "This session" (the decision board), "Journey" (the one
 * longitudinal page — stage, measures, the story, what next session opens
 * with), and "Plan & toolkit" (the working tools). Measures moved inside
 * Journey (a score only means something against the timeline); Case
 * Briefing + Consult became the story section of Journey. Smaller/lighter
 * than the top-level `SessionWorkspaceTabs`. URL: `?tab=copilot&sub=…`,
 * defaulting to `session`; old sub keys redirect in the page parser.
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
