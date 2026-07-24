import { describe, expect, it } from 'vitest';
import {
  bytesToMs,
  classifyFrames,
  DEFAULT_WINDOW_OPTIONS,
  isSilent,
  msToBytes,
  nextWindowBoundary,
  rms,
  windowOptionsFromEnv,
  type WindowOptions,
} from './vad';

/** Build `ms` of constant-amplitude 16 kHz mono s16le PCM. */
function pcm(ms: number, amplitude: number, sampleRate = 16_000): Buffer {
  const samples = Math.round((ms / 1000) * sampleRate);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(amplitude, i * 2);
  return buf;
}

const SPEECH = 8_000; // rms ≈ 0.24
const SILENCE = 0;

const OPTS: WindowOptions = {
  sampleRate: 16_000,
  frameMs: 20,
  threshold: 0.015,
  minWindowMs: 4_000,
  maxWindowMs: 8_000,
  silenceMs: 400,
};

describe('byte/ms conversion', () => {
  it('round-trips on sample boundaries', () => {
    expect(msToBytes(1_000)).toBe(32_000); // 16000 samples × 2 bytes
    expect(bytesToMs(32_000)).toBe(1_000);
    expect(bytesToMs(msToBytes(5_400))).toBe(5_400);
  });
});

describe('rms', () => {
  it('is 0 for silence and well above threshold for speech', () => {
    expect(rms(pcm(100, SILENCE))).toBe(0);
    expect(rms(pcm(100, SPEECH))).toBeCloseTo(SPEECH / 32_768, 3);
    expect(rms(pcm(100, SPEECH))).toBeGreaterThan(OPTS.threshold);
  });
  it('is 0 for an empty buffer', () => {
    expect(rms(Buffer.alloc(0))).toBe(0);
  });
});

describe('classifyFrames / isSilent', () => {
  it('classifies each 20ms sub-frame', () => {
    const frames = classifyFrames(pcm(100, SPEECH), OPTS); // 100ms / 20ms = 5 frames
    expect(frames).toHaveLength(5);
    expect(frames.every((f) => f === true)).toBe(true);
  });
  it('flags a silent buffer as silent', () => {
    expect(isSilent(pcm(100, SILENCE), OPTS)).toBe(true);
    expect(isSilent(pcm(100, SPEECH), OPTS)).toBe(false);
  });
});

describe('nextWindowBoundary', () => {
  it('returns null below the minimum window', () => {
    expect(nextWindowBoundary(pcm(3_000, SPEECH), OPTS)).toBeNull();
  });

  it('cuts at a silence gap once past the minimum window', () => {
    const buf = Buffer.concat([pcm(5_000, SPEECH), pcm(500, SILENCE)]);
    const b = nextWindowBoundary(buf, OPTS);
    expect(b).not.toBeNull();
    expect(b?.reason).toBe('silence');
    // Cut just after the 400ms of confirmed silence → ≈5400ms.
    expect(b?.durationMs).toBeGreaterThanOrEqual(5_300);
    expect(b?.durationMs).toBeLessThanOrEqual(5_500);
  });

  it('force-cuts at the max window when there is no gap', () => {
    const b = nextWindowBoundary(pcm(9_000, SPEECH), OPTS);
    expect(b?.reason).toBe('max');
    expect(b?.durationMs).toBe(8_000);
  });

  it('produces near-uniform windows for a uniform speech/pause cadence (O(n))', () => {
    const block = Buffer.concat([pcm(5_000, SPEECH), pcm(500, SILENCE)]);
    let buf = Buffer.concat([block, block, block, block]);
    const durations: number[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const b = nextWindowBoundary(buf, OPTS);
      if (!b) break;
      durations.push(b.durationMs);
      buf = buf.subarray(b.endByte);
    }
    expect(durations.length).toBeGreaterThanOrEqual(3);
    const first = durations[0]!;
    const last = durations[durations.length - 1]!;
    expect(Math.abs(last - first) / first).toBeLessThanOrEqual(0.2);
  });
});

describe('windowOptionsFromEnv', () => {
  it('returns the latency-tuned defaults with no env set', () => {
    const o = windowOptionsFromEnv({});
    expect(o).toEqual(DEFAULT_WINDOW_OPTIONS);
    expect(o.minWindowMs).toBe(2_500);
    expect(o.maxWindowMs).toBe(6_000);
    expect(o.silenceMs).toBe(400);
  });

  it('applies valid overrides', () => {
    const o = windowOptionsFromEnv({
      LIVE_MIN_WINDOW_MS: '4000',
      LIVE_MAX_WINDOW_MS: '9000',
      LIVE_SILENCE_MS: '800',
    });
    expect(o.minWindowMs).toBe(4_000);
    expect(o.maxWindowMs).toBe(9_000);
    expect(o.silenceMs).toBe(800);
  });

  it('falls back per-field on garbage or out-of-range values', () => {
    const o = windowOptionsFromEnv({
      LIVE_MIN_WINDOW_MS: 'banana',
      LIVE_MAX_WINDOW_MS: '999999',
      LIVE_SILENCE_MS: '5',
    });
    expect(o).toEqual(DEFAULT_WINDOW_OPTIONS);
  });

  it('keeps max ≥ min + 1s when a partial override would invert them', () => {
    const o = windowOptionsFromEnv({ LIVE_MIN_WINDOW_MS: '20000' });
    expect(o.minWindowMs).toBe(20_000);
    expect(o.maxWindowMs).toBe(21_000);
  });
});
