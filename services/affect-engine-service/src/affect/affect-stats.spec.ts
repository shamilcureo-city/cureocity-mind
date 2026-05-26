import { describe, it, expect } from 'vitest';
import { mean, sigmaDistance, stddev } from './affect-stats';

describe('mean', () => {
  it('returns 0 for empty array', () => expect(mean([])).toBe(0));
  it('returns the value for single-element array', () => expect(mean([0.4])).toBe(0.4));
  it('averages multi-element arrays', () => expect(mean([1, 2, 3, 4])).toBe(2.5));
});

describe('stddev', () => {
  it('returns 0 for fewer than 2 elements', () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });
  it('returns the sample standard deviation', () => {
    // [1, 2, 3, 4, 5]: mean = 3, variance = (4+1+0+1+4)/4 = 2.5, sd ≈ 1.5811
    expect(stddev([1, 2, 3, 4, 5])).toBeCloseTo(1.5811, 3);
  });
  it('returns 0 for constant values', () => {
    expect(stddev([0.4, 0.4, 0.4, 0.4])).toBe(0);
  });
});

describe('sigmaDistance', () => {
  it('returns 0 when value equals mean', () => {
    expect(sigmaDistance(0.5, 0.5, 0.1)).toBe(0);
  });
  it('returns positive sigma for values above mean', () => {
    expect(sigmaDistance(0.7, 0.5, 0.1)).toBeCloseTo(2, 5);
  });
  it('returns negative sigma for values below mean', () => {
    expect(sigmaDistance(0.3, 0.5, 0.1)).toBeCloseTo(-2, 5);
  });
  it('returns +/- Infinity when stddev=0 and value differs from mean', () => {
    expect(sigmaDistance(0.6, 0.5, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(sigmaDistance(0.4, 0.5, 0)).toBe(Number.NEGATIVE_INFINITY);
  });
  it('returns 0 when stddev=0 and value matches mean', () => {
    expect(sigmaDistance(0.5, 0.5, 0)).toBe(0);
  });
});
