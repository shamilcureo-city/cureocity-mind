/**
 * Pure-function statistics helpers. Kept separate from the NestJS service
 * so they can be unit-tested without any DI bootstrapping.
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
export function sigmaDistance(value: number, mean: number, stddev: number): number {
  if (stddev === 0) {
    if (value === mean) return 0;
    return value > mean ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return (value - mean) / stddev;
}
