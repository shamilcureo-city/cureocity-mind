import Link from 'next/link';

export type ClientCopilotSubKey = 'journey' | 'briefing' | 'measures' | 'formulation';

interface Props {
  clientId: string;
  active?: ClientCopilotSubKey;
}

const TABS: { key: ClientCopilotSubKey; label: string; hint: string }[] = [
  { key: 'journey', label: 'Journey', hint: 'Where they are, what to do next' },
  { key: 'briefing', label: 'Case Briefing', hint: 'The cross-session synthesis' },
  { key: 'measures', label: 'Measures', hint: 'Instruments + affect trend' },
  { key: 'formulation', label: 'Formulation & Plan', hint: 'Map, diagnosis, therapies' },
];

/**
 * Sprint 27 — secondary tab bar inside the client AI Copilot tab.
 *
 * Smaller and lighter than the top-level `ClientWorkspaceTabs` so the
 * two levels don't compete visually. URL: `?tab=copilot&sub=…`.
 * Defaulting to `journey` keeps a bare `?tab=copilot` deep-link
 * meaningful — the therapist lands on the "what's next" hub.
 */
export function ClientAICopilotSubTabs({ clientId, active = 'journey' }: Props) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
      aria-label="AI Copilot sections"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const href = `/app/clients/${clientId}?tab=copilot&sub=${t.key}`;
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
