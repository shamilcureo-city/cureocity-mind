import type { MeasureTrend } from '@/lib/case-thread';

/**
 * Sprint 73 — score-trend sparklines threaded onto the note.
 *
 * The measurement-based-care loop lived in the Measures sub-tab; this
 * brings the PHQ-9 / GAD-7 arc onto the document itself, so the change
 * is visible right where the therapist reads. Deterministic: the series
 * is the raw administrations, the verdict is the same reliable-change
 * engine the journey composer uses.
 *
 * Server component — inline SVG, no interactivity.
 */
export function MeasuresTrend({ measures }: { measures: MeasureTrend[] }) {
  if (measures.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Progress on measures
        </h3>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {measures.map((m) => (
          <MeasureTile key={m.key} m={m} />
        ))}
      </div>
    </section>
  );
}

function MeasureTile({ m }: { m: MeasureTrend }) {
  const tone = verdictTone(m.verdict);

  return (
    <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[var(--color-ink)]">{m.shortLabel}</span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ color: tone.color, background: tone.bg }}
        >
          {tone.label}
        </span>
      </div>

      <div className="mt-2">
        <Sparkline m={m} color={tone.color} />
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-sm text-[var(--color-ink)]">
          <span className="text-[var(--color-ink-3)]">{m.baseline}</span> → {m.latest}{' '}
          <span className="text-xs text-[var(--color-ink-3)]">/ {m.max}</span>
        </span>
        <span className="text-xs text-[var(--color-ink-2)]">{deltaLabel(m.delta)}</span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
        {m.latestSeverityLabel}
        {m.isRemission && (
          <span className="ml-1 font-medium text-[var(--color-accent)]">· in remission</span>
        )}
      </p>
    </div>
  );
}

/** Compact score-over-time line. Higher score sits higher; a downward line = improvement. */
function Sparkline({ m, color }: { m: MeasureTrend; color: string }) {
  const W = 150;
  const H = 44;
  const PAD = 5;
  const innerW = W - 2 * PAD;
  const innerH = H - 2 * PAD;
  const n = m.points.length;

  const x = (i: number) => (n <= 1 ? PAD + innerW / 2 : PAD + (i / (n - 1)) * innerW);
  const y = (score: number) => PAD + (1 - score / m.max) * innerH;

  const line = m.points.map((p, i) => `${round(x(i))},${round(y(p.score))}`).join(' ');
  const lastX = x(n - 1);
  const lastY = y(m.points[n - 1]!.score);
  const remissionY = round(y(m.remissionCutoff));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label={`${m.shortLabel} trend from ${m.baseline} to ${m.latest} out of ${m.max}`}
      preserveAspectRatio="none"
    >
      {/* Remission guide — at or below this line is remission. */}
      <line
        x1={PAD}
        x2={W - PAD}
        y1={remissionY}
        y2={remissionY}
        stroke="var(--color-line)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={round(lastX)} cy={round(lastY)} r="3.5" fill={color} />
    </svg>
  );
}

function verdictTone(verdict: MeasureTrend['verdict']): {
  color: string;
  bg: string;
  label: string;
} {
  switch (verdict) {
    case 'reliable_improvement':
      return { color: 'var(--color-accent)', bg: 'var(--color-accent-soft)', label: 'Improving' };
    case 'deterioration':
      return { color: 'var(--color-warn)', bg: 'var(--color-warn-bg)', label: 'Worsening' };
    default:
      return { color: 'var(--color-ink-3)', bg: 'var(--color-surface-2)', label: 'Steady' };
  }
}

function deltaLabel(delta: number): string {
  if (delta < 0) return `↓ ${Math.abs(delta)} pts`;
  if (delta > 0) return `↑ ${delta} pts`;
  return 'no change';
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
