import Link from 'next/link';

export type CopilotSubKey = 'review' | 'progress' | 'plan';

interface Props {
  sessionId: string;
  active?: CopilotSubKey;
}

const TABS: { key: CopilotSubKey; label: string; hint: string }[] = [
  { key: 'review', label: 'Review', hint: 'What the copilot heard — you decide' },
  { key: 'progress', label: 'Progress', hint: 'The arc · is it working · next session' },
  // R2 renames this to "Plan" once it renders the real treatment plan.
  { key: 'plan', label: 'Plan & toolkit', hint: 'Plan, diagnosis history, map, library' },
];

/**
 * Sprint 28 → TSC-V2 → Copilot IA redesign (R1) — secondary tab bar inside
 * the AI Copilot tab.
 *
 * Three plain questions that match how a psychologist thinks:
 * - **Review** (was "This session") — what the copilot heard this session;
 *   you decide. The decision board.
 * - **Progress** (was "Journey") — the arc, is it working, what next session
 *   opens with. "Care journey" was dropped: it collided with the Care product.
 * - **Plan** (was "Plan & toolkit") — the client's own treatment plan, with
 *   the scripts + formulation tools around it.
 *
 * URL: `?tab=copilot&sub=…`, defaulting to `review`; old sub keys
 * (session/journey/measures/briefing/formulation) redirect in the page parser.
 */
export function AICopilotSubTabs({ sessionId, active = 'review' }: Props) {
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
