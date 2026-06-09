import type { CaseBriefingV1, JourneySummary } from '@cureocity/contracts';

interface Props {
  journey: JourneySummary | null;
  briefing: CaseBriefingV1 | null;
}

/**
 * Sprint 25 — compact always-visible state band under the identity
 * card. Shows the three bits a therapist needs at a glance regardless
 * of which workspace tab they're on:
 *
 *   1. When is the next session due (vs. recommended cadence)
 *   2. How many running-differential items are still open
 *   3. Latest scored instrument with a trend arrow
 *
 * Pure composition — every value is already loaded for the page; no
 * extra queries.
 */
export function TodayStrip({ journey, briefing }: Props) {
  const chips: { label: string; value: string; tone?: 'warn' | 'accent' }[] = [];

  // Next session — derived from cadence + lastSessionAt.
  const next = computeNextSessionChip(journey, briefing);
  if (next) chips.push(next);

  // Open items from the running differential.
  if (briefing && briefing.openItems.length > 0) {
    chips.push({
      label: 'Still to find out',
      value: `${briefing.openItems.length}`,
    });
  }

  // Latest scored instrument + trend.
  const instrument = computeInstrumentChip(journey);
  if (instrument) chips.push(instrument);

  if (chips.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[var(--color-line-soft)] bg-white/60 px-4 py-2.5 text-sm">
      {chips.map((c, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5">
          <span className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            {c.label}
          </span>
          <span
            className={`font-medium ${
              c.tone === 'warn'
                ? 'text-[var(--color-warn)]'
                : c.tone === 'accent'
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-ink)]'
            }`}
          >
            {c.value}
          </span>
        </span>
      ))}
    </div>
  );
}

function computeNextSessionChip(
  journey: JourneySummary | null,
  briefing: CaseBriefingV1 | null,
): { label: string; value: string; tone?: 'warn' } | null {
  if (!briefing) return null;
  const interval = briefing.cadence.recommendedIntervalDays;
  const last = journey?.lastSessionAt ? new Date(journey.lastSessionAt).getTime() : null;
  if (!last) {
    return { label: 'Next session', value: `every ~${interval}d` };
  }
  const dueAt = last + interval * 24 * 60 * 60 * 1000;
  const diff = dueAt - Date.now();
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days < -1) {
    return { label: 'Next session', value: `overdue · ${Math.abs(days)}d`, tone: 'warn' };
  }
  if (days <= 0) {
    return { label: 'Next session', value: 'due today' };
  }
  return { label: 'Next session', value: `in ${days}d` };
}

function computeInstrumentChip(
  journey: JourneySummary | null,
): { label: string; value: string; tone?: 'warn' | 'accent' } | null {
  if (!journey || journey.instrumentChanges.length === 0) return null;
  // Surface the most recently administered one — the one the therapist
  // last touched is the most useful at-a-glance.
  const c = journey.instrumentChanges[0];
  if (!c) return null;
  const arrow =
    c.verdict === 'reliable_improvement'
      ? '↓'
      : c.verdict === 'deterioration'
        ? '↑'
        : '·';
  const tone: 'accent' | 'warn' | undefined =
    c.verdict === 'reliable_improvement'
      ? 'accent'
      : c.verdict === 'deterioration'
        ? 'warn'
        : undefined;
  return {
    label: c.instrumentKey,
    value: `${c.latestScore} ${arrow}`,
    ...(tone !== undefined && { tone }),
  };
}
