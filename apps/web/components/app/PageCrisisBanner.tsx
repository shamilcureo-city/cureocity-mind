import type { CaseBriefingV1 } from '@cureocity/contracts';

interface Props {
  briefing: CaseBriefingV1 | null;
}

/**
 * Sprint 25 — page-level safety banner. Rendered above the tab nav so
 * that an active crisis flag is visible from every tab, not buried
 * inside the Clinical Engine tab as it was before. Hidden when
 * severity is none/low (those don't warrant a page-level interrupt).
 *
 * Reuses the case-briefing safety shape verbatim — same severities,
 * same flags. The Clinical Engine tab still surfaces the full Safety
 * section inside the Case Briefing panel; this is the compact alert.
 */
export function PageCrisisBanner({ briefing }: Props) {
  if (!briefing) return null;
  const sev = briefing.safety.highestSeverity;
  if (sev === 'none' || sev === 'low') return null;

  const isCritical = sev === 'critical' || sev === 'high';
  const tone = isCritical ? 'critical' : 'medium';
  const flagsText =
    briefing.safety.openCrisisFlags.length > 0
      ? briefing.safety.openCrisisFlags.join(' · ')
      : 'Active crisis flag';

  return (
    <div
      role="alert"
      className={`mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm ${
        tone === 'critical'
          ? 'border-[var(--color-warn)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
          : 'border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-ink)]'
      }`}
    >
      <span className="font-semibold uppercase tracking-wide">Safety · {sev}</span>
      <span className="flex-1">{flagsText}</span>
      <span className="text-xs">
        {briefing.safety.hasSafetyPlan
          ? 'Safety plan on file — review it before this session.'
          : 'No safety plan on file — author one before this session.'}
      </span>
    </div>
  );
}
