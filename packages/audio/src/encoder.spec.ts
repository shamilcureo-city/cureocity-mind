import { describe, it, expect } from 'vitest';
import { float32ToInt16Le, int16LeToFloat32 } from './encoder';

describe('float32ToInt16Le', () => {
  it('encodes silence to zero bytes', () => {
    const bytes = float32ToInt16Le(new Float32Array(4));
    expect(Array.from(bytes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('encodes +1.0 to max positive Int16 (32767)', () => {
    const bytes = float32ToInt16Le(new Float32Array([1.0]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(32767);
  });

  it('encodes -1.0 to min negative Int16 (-32768)', () => {
    const bytes = float32ToInt16Le(new Float32Array([-1.0]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(-32768);
  });

  it('clips values outside [-1, 1]', () => {
    const bytes = float32ToInt16Le(new Float32Array([2.0, -3.0]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });
});

describe('round-trip Float32 ↔ Int16', () => {
  it('preserves values to within 1/32767 quantisation', () => {
    const original = new Float32Array(1024);
    for (let i = 0; i < original.length; i++) {
      original[i] = Math.sin((2 * Math.PI * i) / 64) * 0.9;
    }
    const bytes = float32ToInt16Le(original);
    const round = int16LeToFloat32(bytes);
    expect(round.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(round[i]! - original[i]!)).toBeLessThan(1 / 30000);
    }
  });
});
