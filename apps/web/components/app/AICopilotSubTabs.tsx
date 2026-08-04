import Link from 'next/link';

export type CopilotSubKey = 'session' | 'progress';

interface Props {
  sessionId: string;
  active?: CopilotSubKey;
}

const TABS: { key: CopilotSubKey; label: string; hint: string }[] = [
  { key: 'session', label: 'Session', hint: 'Review, decide & sign — one pass' },
  { key: 'progress', label: 'Progress', hint: 'The arc · is it working · next session' },
];

/**
 * Sprint 28 → TSC-V2 → R1 → the CP merge — secondary tab bar inside the AI
 * Copilot tab. Two plain questions:
 *
 * - **Session** — everything this session asks of you, one board worked
 *   top-to-bottom: safety → impression → ask-next → plan → wrap up & sign.
 *   The old "Close the loop" sub-tab was merged in: its unique moments
 *   (formulation updates, agreements, alliance, the signature) now live on
 *   the board, and the session ends with ONE ceremony — the note signature.
 * - **Progress** — the longitudinal arc, is it working, what next session
 *   opens with.
 *
 * URL: `?tab=copilot&sub=…`, defaulting to `session`; old sub keys
 * (close/review/session/journey/measures/briefing/formulation) redirect in
 * the page parser.
 */
export function AICopilotSubTabs({ sessionId, active = 'session' }: Props) {
  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-line-soft)]"
      aria-label="AI Copilot sections"
    >
      {/* Mobile: the bar scrolls horizontally instead of wrapping; hints hide below sm. */}
      {TABS.map((t) => {
        const isActive = t.key === active;
        const href = `/app/sessions/${sessionId}?tab=copilot&sub=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            className={`inline-flex shrink-0 flex-col items-start border-b-2 px-3 py-2 text-xs transition-colors ${
              isActive
                ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="text-sm font-medium">{t.label}</span>
            <span className="hidden text-[10px] text-[var(--color-ink-3)] sm:block">{t.hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
