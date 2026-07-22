/**
 * Sprint 20 — Reliable-change engine for scored instruments.
 *
 * Measurement-Based Care only works if the SYMPTOM TREND is fed back to
 * the clinician with a verdict, not just a list of raw scores. This module
 * turns a baseline + latest score into a clinically-grounded verdict —
 * deterministically, NO LLM. The thresholds below are from the validation
 * literature:
 *
 *   - PHQ-9 reliable change / MCID ≈ 5 points (2 SEM); remission ≤ 4.
 *     Kroenke 2001; Löwe 2004 "Monitoring depression treatment outcomes".
 *   - GAD-7 reliable change ≈ 4 points; remission ≤ 4 (minimal band).
 *     Spitzer 2006.
 *   - "Response" = ≥50% reduction from baseline — the standard trial
 *     responder definition used across depression/anxiety RCTs.
 *
 * Lower scores are better for BOTH instruments, so a NEGATIVE delta
 * (latest < baseline) is improvement.
 */

import { INSTRUMENTS, type InstrumentKey } from './index';

/** Points of change that exceed measurement error — a "reliable" change. */
export const RELIABLE_CHANGE_THRESHOLD: Record<InstrumentKey, number> = {
  PHQ9: 5,
  GAD7: 4,
};

/** At-or-below this latest score counts as remission. */
export const REMISSION_CUTOFF: Record<InstrumentKey, number> = {
  PHQ9: 4,
  GAD7: 4,
};

export type ChangeVerdict = 'reliable_improvement' | 'no_reliable_change' | 'deterioration';

export interface InstrumentChange {
  /** latest - baseline. Negative = improvement (lower is better). */
  delta: number;
  /**
   * Percent change vs baseline (negative = improvement). Null when the
   * baseline is 0 (no meaningful denominator).
   */
  percentChange: number | null;
  verdict: ChangeVerdict;
  /** ≥50% reduction from baseline — the trial "responder" definition. */
  isResponse: boolean;
  /** Latest score at or below the remission cutoff. */
  isRemission: boolean;
  baselineSeverityKey: string;
  latestSeverityKey: string;
}

export class InstrumentChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstrumentChangeError';
  }
}

/** Look up the severity-band key for a raw score on a given instrument. */
export function severityKeyForScore(key: InstrumentKey, score: number): string {
  const def = INSTRUMENTS[key];
  const band = def.severityBands.find((b) => score >= b.min && score <= b.max);
  if (!band) {
    throw new InstrumentChangeError(
      `Score ${score} is outside the known severity bands for ${key}`,
    );
  }
  return band.key;
}

/**
 * Compute the reliable-change verdict between a baseline and a latest
 * administration of the same instrument. Both scores must be valid raw
 * totals (0..max) for the instrument.
 */
export function computeInstrumentChange(
  key: InstrumentKey,
  baselineScore: number,
  latestScore: number,
): InstrumentChange {
  if (!Number.isFinite(baselineScore) || !Number.isFinite(latestScore)) {
    throw new InstrumentChangeError('Scores must be finite numbers');
  }
  const delta = latestScore - baselineScore;
  const magnitude = Math.abs(delta);
  const threshold = RELIABLE_CHANGE_THRESHOLD[key];

  let verdict: ChangeVerdict;
  if (magnitude < threshold) {
    verdict = 'no_reliable_change';
  } else if (delta < 0) {
    verdict = 'reliable_improvement';
  } else {
    verdict = 'deterioration';
  }

  const percentChange = baselineScore > 0 ? Math.round((delta / baselineScore) * 1000) / 10 : null;
  const isResponse = baselineScore > 0 && (baselineScore - latestScore) / baselineScore >= 0.5;
  const isRemission = latestScore <= REMISSION_CUTOFF[key];

  return {
    delta,
    percentChange,
    verdict,
    isResponse,
    isRemission,
    baselineSeverityKey: severityKeyForScore(key, baselineScore),
    latestSeverityKey: severityKeyForScore(key, latestScore),
  };
}

export interface InstrumentTrajectory {
  /** Best (lowest) score across the whole series. */
  nadir: number;
  /** Worst (highest) score across the whole series. */
  peak: number;
  /** Most recent score. */
  latest: number;
  /**
   * The latest score has risen back above the best point that PRECEDED it by
   * at least the instrument's reliable-change threshold — a relapse the plain
   * baseline-vs-latest verdict misses (e.g. PHQ-9 18 → 8 → 16 reads as "no
   * reliable change" first-vs-last, but is a clear slide from the nadir).
   */
  recentlyWorsening: boolean;
}

/**
 * CP-B — trajectory-aware reliable change. `computeInstrumentChange` only sees
 * the first and latest administrations, so a client who got better then
 * slipped back is invisible to it. This looks at the whole series and flags a
 * reliable rise from the pre-latest nadir, so a review can be pulled forward.
 * Reuses RELIABLE_CHANGE_THRESHOLD — it never loosens the clinical thresholds.
 * Returns null for a series shorter than two readings.
 */
export function computeInstrumentTrajectory(
  key: InstrumentKey,
  series: number[],
): InstrumentTrajectory | null {
  const clean = series.filter((s) => Number.isFinite(s));
  if (clean.length < 2) return null;
  const latest = clean[clean.length - 1]!;
  const priorNadir = Math.min(...clean.slice(0, clean.length - 1));
  const threshold = RELIABLE_CHANGE_THRESHOLD[key];
  return {
    nadir: Math.min(...clean),
    peak: Math.max(...clean),
    latest,
    recentlyWorsening: latest - priorNadir >= threshold,
  };
}
