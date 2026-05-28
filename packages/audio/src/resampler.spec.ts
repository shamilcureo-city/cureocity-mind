import { describe, it, expect } from 'vitest';
import { PolyphaseDecimator } from './resampler';

describe('PolyphaseDecimator', () => {
  it('produces output length ≈ input length / decimation factor', () => {
    const decimator = new PolyphaseDecimator(3);
    const input = new Float32Array(3000);
    const out = decimator.process(input);
    expect(out.length).toBe(1000);
  });

  it('passes DC unchanged (unity gain at 0 Hz)', () => {
    const decimator = new PolyphaseDecimator(3);
    const input = new Float32Array(3000).fill(0.5);
    // Warm-up: discard the first chunk so the FIR filter has settled.
    decimator.process(input);
    const out = decimator.process(input);
    const last = out[out.length - 1] ?? 0;
    expect(last).toBeCloseTo(0.5, 3);
  });

  it('attenuates a tone above the new Nyquist (12 kHz @ 48 kHz)', () => {
    const sampleRate = 48_000;
    const toneHz = 12_000; // above 16 kHz / 2 = 8 kHz Nyquist of output
    const lenSec = 1;
    const N = sampleRate * lenSec;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * toneHz * i) / sampleRate);
    const decimator = new PolyphaseDecimator(3);
    const out = decimator.process(input);
    // Skip the filter warm-up region and measure RMS over the tail.
    const tail = out.subarray(out.length - 4000);
    let sumSq = 0;
    for (const x of tail) sumSq += x * x;
    const rms = Math.sqrt(sumSq / tail.length);
    // 12 kHz tone is well above the 7.5 kHz cutoff; expect strong
    // attenuation. Hann-windowed sinc at this length gives at least ~25 dB.
    expect(rms).toBeLessThan(0.05);
  });

  it('passes a tone below the new Nyquist (1 kHz @ 48 kHz)', () => {
    const sampleRate = 48_000;
    const toneHz = 1_000;
    const N = sampleRate;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * toneHz * i) / sampleRate);
    const decimator = new PolyphaseDecimator(3);
    const out = decimator.process(input);
    const tail = out.subarray(out.length - 4000);
    let sumSq = 0;
    for (const x of tail) sumSq += x * x;
    const rms = Math.sqrt(sumSq / tail.length);
    // Sine RMS = 1/sqrt(2) ≈ 0.707; allow ~10% loss from filter.
    expect(rms).toBeGreaterThan(0.6);
    expect(rms).toBeLessThan(0.8);
  });

  it('reset() clears state — DC after reset starts fresh', () => {
    const decimator = new PolyphaseDecimator(3);
    decimator.process(new Float32Array(3000).fill(0.5));
    decimator.reset();
    // Burn the warm-up + measure DC.
    const N = 6000;
    const out = decimator.process(new Float32Array(N).fill(0.3));
    const last = out[out.length - 1] ?? 0;
    expect(last).toBeCloseTo(0.3, 3);
  });

  it('rejects factor / taps mismatch in constructor', () => {
    expect(() => new PolyphaseDecimator(3, 95)).toThrow(/divisible/i);
  });
});
