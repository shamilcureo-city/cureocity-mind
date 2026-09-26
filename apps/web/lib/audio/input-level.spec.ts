import { describe, expect, it } from 'vitest';
import { measureInputLevel } from './input-level';

describe('microphone input level', () => {
  it('reports no activity for silence or an empty frame', () => {
    expect(measureInputLevel(new Float32Array(480))).toBe(0);
    expect(measureInputLevel(new Float32Array())).toBe(0);
  });

  it('measures both polarities and accounts for quiet parts of the frame', () => {
    expect(measureInputLevel(new Float32Array([0.5, -0.5]))).toBe(0.5);
    expect(measureInputLevel(new Float32Array([1, 0, 0, 0]))).toBe(0.5);
  });

  it('stays finite and bounded for clipped or malformed input', () => {
    expect(measureInputLevel(new Float32Array([2, -2]))).toBe(1);
    expect(measureInputLevel(new Float32Array([Number.NaN, Infinity]))).toBe(0);
    expect(measureInputLevel(new Float32Array([1, Number.NaN, 0, 0]))).toBe(0.5);
  });
});
