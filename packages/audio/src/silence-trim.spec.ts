import { describe, expect, it } from 'vitest';
import { SilenceTrimmer } from './silence-trim';

const SR = 16_000;

/** A loud tone — RMS ≈ 0.14, comfortably above the 0.008 threshold. */
function speech(nSamples: number, amp = 0.2): Float32Array {
  const out = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR);
  return out;
}

function silence(nSamples: number): Float32Array {
  return new Float32Array(nSamples); // all zeros → RMS 0
}

function join(...parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function runOneShot(t: SilenceTrimmer, input: Float32Array): Float32Array {
  return join(t.process(input), t.flush());
}

function maxAbs(a: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}

describe('SilenceTrimmer', () => {
  it('passes pure speech through unchanged', () => {
    const t = new SilenceTrimmer();
    const input = speech(2 * SR); // 2 s
    const out = runOneShot(t, input);
    expect(out.length).toBe(input.length);
    expect(Array.from(out)).toEqual(Array.from(input));
    expect(t.getStats().droppedSamples).toBe(0);
  });

  it('keeps a short pause (< minSilence) verbatim', () => {
    const t = new SilenceTrimmer(); // minSilence 2 s
    const input = join(speech(SR), silence(SR), speech(SR)); // 1 s pause
    const out = runOneShot(t, input);
    expect(out.length).toBe(input.length);
    expect(Array.from(out)).toEqual(Array.from(input));
    expect(t.getStats().droppedSamples).toBe(0);
  });

  it('collapses a long silence, keeping padding on both edges and all speech', () => {
    const t = new SilenceTrimmer({ minSilenceMs: 2000, paddingMs: 300 });
    const s1 = speech(SR);
    const s2 = speech(SR, 0.15);
    const gap = silence(6 * SR); // 6 s → collapsed
    const out = runOneShot(t, join(s1, gap, s2));

    const pad = 0.3 * SR; // 4800
    // speech kept whole + gap collapsed to lead(pad) + trail(pad).
    expect(out.length).toBe(s1.length + 2 * pad + s2.length);
    // Leading speech preserved exactly at the head.
    expect(Array.from(out.subarray(0, s1.length))).toEqual(Array.from(s1));
    // Trailing speech preserved exactly at the tail.
    expect(Array.from(out.subarray(out.length - s2.length))).toEqual(Array.from(s2));
    // The collapsed middle is silence.
    expect(maxAbs(out.subarray(s1.length, s1.length + 2 * pad))).toBe(0);

    const stats = t.getStats();
    expect(stats.droppedSamples).toBe(6 * SR - 2 * pad);
    expect(stats.inputSamples).toBe(stats.outputSamples + stats.droppedSamples);
  });

  it('never clips an isolated speech frame between long silences', () => {
    const t = new SilenceTrimmer();
    const frame = speech(320); // one 20 ms analysis frame
    const out = runOneShot(t, join(silence(6 * SR), frame, silence(6 * SR)));
    // The speech survived somewhere in the output.
    expect(maxAbs(out)).toBeGreaterThan(0.1);
    // Each long silence collapses to lead + trail (2 × padding).
    const pad = 0.3 * SR;
    expect(out.length).toBe(2 * pad + frame.length + 2 * pad);
  });

  it('is streaming-invariant: chunked input == one-shot input', () => {
    const input = join(
      speech(SR),
      silence(3 * SR),
      speech(SR),
      silence(SR),
      speech(SR),
      silence(5 * SR),
      speech(SR),
    );

    const oneShot = runOneShot(new SilenceTrimmer(), input);

    const t = new SilenceTrimmer();
    const parts: Float32Array[] = [];
    // Push in awkward, non-frame-aligned slices.
    for (let i = 0; i < input.length; i += 777) {
      parts.push(t.process(input.subarray(i, Math.min(i + 777, input.length))));
    }
    parts.push(t.flush());
    const streamed = join(...parts);

    expect(streamed.length).toBe(oneShot.length);
    expect(Array.from(streamed)).toEqual(Array.from(oneShot));
  });

  it('clamps padding so lead+trail never exceed the run (net trim stays positive)', () => {
    // padding (300 ms × 2 = 600 ms) would exceed minSilence (100 ms); it must
    // clamp so a long gap still nets a trim.
    const t = new SilenceTrimmer({ minSilenceMs: 100, paddingMs: 300 });
    const out = runOneShot(t, join(speech(SR), silence(4 * SR), speech(SR)));
    const stats = t.getStats();
    expect(stats.droppedSamples).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(6 * SR);
    expect(stats.inputSamples).toBe(stats.outputSamples + stats.droppedSamples);
  });

  it('accounts every input sample as output or dropped', () => {
    const t = new SilenceTrimmer();
    const input = join(speech(SR), silence(4 * SR), speech(SR), silence(SR), speech(SR));
    runOneShot(t, input);
    const s = t.getStats();
    expect(s.inputSamples).toBe(input.length);
    expect(s.outputSamples + s.droppedSamples).toBe(input.length);
  });

  it('handles a stream that ends in a long silence (flush collapses it)', () => {
    const t = new SilenceTrimmer();
    const out = runOneShot(t, join(speech(SR), silence(6 * SR)));
    const pad = 0.3 * SR;
    // trailing silence with no following speech → still collapsed on flush,
    // keeping lead + trail padding.
    expect(out.length).toBe(SR + 2 * pad);
    expect(t.getStats().droppedSamples).toBe(6 * SR - 2 * pad);
  });
});
