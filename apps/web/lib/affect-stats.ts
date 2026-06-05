/**
 * Pure-function statistics helpers for the affect engine. Ported from
 * services/affect-engine-service/src/affect/affect-stats.ts so the
 * monolith-mode apps/web routes don't need to depend on the service
 * scaffold. Identical logic — kept in sync by hand for V1.
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1 denominator). Falls back to 0 for n<2. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sumSquares = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

/**
 * How many standard deviations is `value` from `mean`? Returns Infinity
 * with sign(value - mean) if stddev is 0 and value != mean; 0 if equal.
 */
export function sigmaDistance(value: number, m: number, sd: number): number {
  if (sd === 0) {
    if (value === m) return 0;
    return value > m ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return (value - m) / sd;
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}
