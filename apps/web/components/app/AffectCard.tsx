'use client';

import { useEffect, useState } from 'react';
import type { AffectTrend } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';

interface Props {
  clientId: string;
  scribeBase?: string;
}

/**
 * Compact affect-trend card embedded in the Client tab. Shows the
 * baseline state (INSUFFICIENT_DATA until 4+ sessions have features),
 * the latest session's valence/arousal, and any neutral-language
 * deviation flags from the engine. Renders nothing while loading or
 * when there's no signal worth surfacing.
 *
 * The whole component fails silently — the affect engine is a
 * "nice-to-have" surface, never a blocker for clinical work.
 */
export function AffectCard({ clientId, scribeBase = '/api/v1' }: Props) {
  const [trend, setTrend] = useState<AffectTrend | null>(null);
  const [showNumbers, setShowNumbers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${scribeBase}/clients/${clientId}/affect/trend`);
        if (!res.ok) return;
        const body = (await res.json()) as AffectTrend;
        if (!cancelled) setTrend(body);
      } catch {
        // Silent — see component comment.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, scribeBase]);

  if (!trend) return null;

  const baseline = trend.baseline;
  const latest = trend.points[0];
  const recentDeviations = trend.deviations
    .filter((d) => latest && d.sessionId === latest.sessionId)
    .slice(0, 3);

  return (
    <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Affect baseline
        </h3>
        {baseline.status === 'ESTABLISHED' ? (
          <Badge tone="accent">Established</Badge>
        ) : (
          <Badge tone="muted">Insufficient data</Badge>
        )}
      </header>

      {baseline.status === 'INSUFFICIENT_DATA' ? (
        (() => {
          const remaining = Math.max(0, baseline.minSessions - baseline.sessionsUsed);
          return (
            <p className="mt-3 text-sm text-[var(--color-ink-2)]">
              {remaining > 0
                ? `Record ${remaining} more session${remaining === 1 ? '' : 's'} to establish an emotional-tone baseline.`
                : 'Baseline will appear once the latest sessions have been processed.'}
              <span className="mt-1 block text-xs text-[var(--color-ink-3)]">
                {baseline.sessionsUsed} of {baseline.minSessions} sessions with usable audio so far.
              </span>
            </p>
          );
        })()
      ) : (
        <>
          <p className="mt-3 text-sm text-[var(--color-ink)]">
            {toneSummary(baseline.valence?.mean ?? null, baseline.arousal?.mean ?? null)}
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            Typical tone across {baseline.sessionsUsed} of the last {baseline.windowSessions}{' '}
            completed sessions.
          </p>
          {latest && (
            <p className="mt-2 text-xs text-[var(--color-ink-3)]">
              Most recent session:{' '}
              {toneSummary(latest.meanValence, latest.meanArousal).toLowerCase()}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowNumbers((v) => !v)}
            aria-expanded={showNumbers}
            className="mt-3 inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-3)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
          >
            <span aria-hidden>{showNumbers ? '×' : 'ⓘ'}</span>
            {showNumbers ? 'Hide numbers' : 'Show numbers'}
          </button>
          {showNumbers && (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-[var(--color-ink-2)]">
              <div>
                <dt className="text-[var(--color-ink-3)]">Valence (−1…+1)</dt>
                <dd className="font-mono">
                  mean {baseline.valence?.mean.toFixed(2)} · σ {baseline.valence?.stddev.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-3)]">Arousal (0…1)</dt>
                <dd className="font-mono">
                  mean {baseline.arousal?.mean.toFixed(2)} · σ {baseline.arousal?.stddev.toFixed(2)}
                </dd>
              </div>
              {latest && (
                <div className="col-span-2 text-[var(--color-ink-3)]">
                  Last session: valence {latest.meanValence.toFixed(2)}, arousal{' '}
                  {latest.meanArousal.toFixed(2)} ({latest.sampleCount} samples)
                </div>
              )}
            </dl>
          )}
          {recentDeviations.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-[var(--color-line-soft)] pt-3">
              {recentDeviations.map((d, i) => (
                <li key={i} className="text-xs text-[var(--color-warn)]">
                  ⚠ {d.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// Plain-language read of the emotional tone from valence (−1…+1, low→high
// mood) and arousal (0…1, calm→activated). Keeps the raw numbers out of the
// default view — they live behind "Show numbers".
function toneSummary(valence: number | null, arousal: number | null): string {
  if (valence === null || arousal === null) return 'Emotional tone recorded.';
  const mood =
    valence <= -0.2
      ? 'low, heavier mood'
      : valence >= 0.2
        ? 'brighter, more positive mood'
        : 'fairly even mood';
  const energy =
    arousal >= 0.6 ? 'tense, high energy' : arousal <= 0.35 ? 'calm, low energy' : 'steady energy';
  return `Generally a ${mood} with ${energy}.`;
}
