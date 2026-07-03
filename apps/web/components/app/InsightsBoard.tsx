import Link from 'next/link';
import {
  DISMISS_REASON_LABELS,
  type CardTypeStats,
  type DoctorInsights,
} from '@cureocity/contracts';
import { Card } from '../ui/Card';

/**
 * Sprint DS9 — the end-of-clinic evidence view (screen 11).
 *
 * Every number is a rollup of already-persisted data (DS0 meter + DS3/DS6
 * suggestion audit + sessions). The pre-registered pilot targets render as
 * reference lines so the kill-criteria are visibly tracked. Server-rendered;
 * the day range is a set of links, export is a plain download link. See
 * docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS9.
 */
const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

const CARD_LABEL: Record<CardTypeStats['kind'], string> = {
  DIFFERENTIAL: 'Differential',
  ASK_NEXT: 'Ask-next',
  RED_FLAG: 'Red flags',
  GAP: 'Gaps / coding',
};

export function InsightsBoard({ insights, days }: { insights: DoctorInsights; days: number }) {
  const activationPct = insights.activationRate;
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">Insights</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">
            {insights.consults} copilot consult{insights.consults === 1 ? '' : 's'} ·{' '}
            {rangeLabel(days)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-[var(--color-line)]">
            {RANGES.map((r) => (
              <Link
                key={r.days}
                href={`/app/insights?days=${r.days}`}
                className={`px-3.5 py-1.5 text-sm ${
                  r.days === days
                    ? 'bg-[var(--color-accent)] font-medium text-white'
                    : 'bg-white text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]'
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
          <a
            href={`/api/v1/insights/export?days=${days}`}
            className="rounded-full border border-[var(--color-line)] bg-white px-3.5 py-1.5 text-sm font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile
          label="Activation"
          value={activationPct == null ? '—' : pct(activationPct)}
          sub={`${insights.consults}/${insights.totalSessions} sessions`}
          target={`target ${pct(insights.targets.activation)}`}
          hit={activationPct != null && activationPct >= insights.targets.activation}
        />
        <Tile
          label="Patients / hour"
          value={insights.tokensPerHour == null ? '—' : insights.tokensPerHour.toFixed(1)}
          sub="throughput"
        />
        <Tile
          label="Avg consult"
          value={
            insights.avgConsultMinutes == null ? '—' : `${insights.avgConsultMinutes.toFixed(1)}m`
          }
          sub="mic-on time"
        />
        <Tile
          label="Criticals caught"
          value={String(insights.criticalsCaught)}
          sub="red flags acted on"
          accent
        />
        <Tile
          label="Cost / consult"
          value={insights.avgCostInr == null ? '—' : `₹${insights.avgCostInr.toFixed(2)}`}
          sub="≤ ₹3 ceiling"
          hit={insights.avgCostInr != null && insights.avgCostInr <= 3}
        />
        <Tile
          label="Ask-next act-rate"
          value={insights.askNextActRate == null ? '—' : pct(insights.askNextActRate)}
          sub="asked / shown"
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        {/* Acceptance bars */}
        <Card className="p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-3)]">
            Suggestion acceptance
          </h2>
          <div className="mt-4 space-y-4">
            {insights.cards.map((c) => (
              <AcceptanceBar key={c.kind} card={c} />
            ))}
          </div>
          {/* Rx ≤1-edit — target tracked, value pending the signed-Rx diff */}
          <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Rx ≤ 1-edit rate</span>
              <span className="text-[var(--color-ink-3)]">
                {insights.rxOneEditRate == null
                  ? 'pending signed-Rx diff'
                  : pct(insights.rxOneEditRate)}
                <span className="ml-2 text-xs">target {pct(insights.targets.rxOneEdit)}</span>
              </span>
            </div>
          </div>
        </Card>

        {/* Right column: catches + dismiss reasons */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-3)]">
              Catches worth reading
            </h2>
            {insights.catches.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-3)]">
                No red flags acted on in this window.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {insights.catches.map((c) => (
                  <li key={`${c.label}-${c.at}`} className="flex gap-2 text-[13px]">
                    <span className="mt-0.5 text-[#c0392b]">⚑</span>
                    <span className="flex-1 leading-snug text-[var(--color-ink)]">{c.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-3)]">
              Why dismissed
            </h2>
            {insights.dismissReasons.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-3)]">No dismiss reasons captured.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {insights.dismissReasons.map((d) => (
                  <span
                    key={d.reason}
                    className="rounded-full bg-[var(--color-surface-soft)] px-3 py-1 text-[13px] text-[var(--color-ink-2)]"
                  >
                    {DISMISS_REASON_LABELS[d.reason]}
                    <span className="ml-1.5 font-semibold tabular-nums">{d.count}</span>
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <p className="mt-4 text-xs text-[var(--color-ink-3)]">
        Pilot targets (pre-registered): activation &gt; {pct(insights.targets.activation)} of
        eligible consults by week 3 · Rx ≤ 1-edit ≥ {pct(insights.targets.rxOneEdit)}. Ask-next
        act-rate is tracked without a target — the pilot generates the first data.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  target,
  hit,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  target?: string;
  hit?: boolean;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          accent ? 'text-[#c0392b]' : 'text-[var(--color-ink)]'
        }`}
      >
        {value}
      </p>
      <div className="mt-0.5 flex items-center gap-2">
        {sub && <span className="text-[11px] text-[var(--color-ink-3)]">{sub}</span>}
        {target && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              hit
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'bg-[var(--color-surface-soft)] text-[var(--color-ink-3)]'
            }`}
          >
            {hit ? '✓ ' : ''}
            {target}
          </span>
        )}
      </div>
    </Card>
  );
}

function AcceptanceBar({ card }: { card: CardTypeStats }) {
  const actedPct = card.shown > 0 ? (card.acted / card.shown) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-[var(--color-ink)]">{CARD_LABEL[card.kind]}</span>
        <span className="text-[var(--color-ink-3)] tabular-nums">
          {card.actRate == null ? '—' : pct(card.actRate)}
          <span className="ml-1.5 text-[11px]">
            {card.acted}/{card.shown} acted
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
          style={{ width: `${Math.min(100, actedPct)}%` }}
        />
      </div>
      {(card.dismissed > 0 || card.autoResolved > 0) && (
        <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">
          {card.dismissed} dismissed · {card.autoResolved} auto-resolved
        </p>
      )}
    </div>
  );
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function rangeLabel(days: number): string {
  if (days === 1) return 'today';
  return `last ${days} days`;
}
