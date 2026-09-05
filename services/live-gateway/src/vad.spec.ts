import { describe, expect, it } from 'vitest';
import {
  bytesToMs,
  classifyFrames,
  DEFAULT_WINDOW_OPTIONS,
  isSilent,
  msToBytes,
  nextWindowBoundary,
  rms,
  speechFraction,
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
  minSpeechFraction: 0.05,
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
  it('speechFraction: ~1 for all speech, near 0 for a quiet window with a blip', () => {
    expect(speechFraction(pcm(500, SPEECH), OPTS)).toBe(1);
    // 2 s of silence + a 100 ms noise blip → ~5% speech (the hallucination case
    // isSilent misses because the blip lifts the window average above threshold).
    const quietWithBlip = Buffer.concat([pcm(2_000, SILENCE), pcm(100, SPEECH)]);
    expect(isSilent(quietWithBlip, OPTS)).toBe(false); // average is NOT silent…
    expect(speechFraction(quietWithBlip, OPTS)).toBeLessThan(0.06); // …but density is tiny
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

  it('closes a short answer at the minimum instead of waiting for the maximum', () => {
    const buf = Buffer.concat([pcm(1_000, SPEECH), pcm(1_500, SILENCE)]);
    expect(nextWindowBoundary(buf.subarray(0, msToBytes(2_480)))).toBeNull();
    expect(nextWindowBoundary(buf)).toEqual({
      endByte: msToBytes(2_500),
      durationMs: 2_500,
      reason: 'silence',
    });
  });

  it.each([
    [2_080, 420, 2_500],
    [2_100, 400, 2_500],
    [2_120, 380, null],
    [2_120, 400, 2_520],
    [2_500, 400, 2_900],
  ])(
    'requires both the minimum window and a complete pause (%ims speech + %ims silence)',
    (speechMs, silenceMs, expectedMs) => {
      const boundary = nextWindowBoundary(
        Buffer.concat([pcm(speechMs!, SPEECH), pcm(silenceMs!, SILENCE)]),
      );
      if (expectedMs === null) {
        expect(boundary).toBeNull();
      } else {
        expect(boundary).toEqual({
          endByte: msToBytes(expectedMs!),
          durationMs: expectedMs,
          reason: 'silence',
        });
      }
    },
  );

  it('does not reuse an early pause after speech has resumed across the minimum', () => {
    const buf = Buffer.concat([pcm(1_000, SPEECH), pcm(1_000, SILENCE), pcm(500, SPEECH)]);
    expect(nextWindowBoundary(buf)).toBeNull();
    expect(nextWindowBoundary(Buffer.concat([buf, pcm(400, SILENCE)]))?.durationMs).toBe(2_900);
  });

  it('does not count a partial frame as the complete required silence', () => {
    const buf = Buffer.concat([pcm(3_000, SPEECH), pcm(399, SILENCE)]);
    expect(nextWindowBoundary(buf)).toBeNull();
    expect(nextWindowBoundary(Buffer.concat([buf, pcm(1, SILENCE)]))).toEqual({
      endByte: msToBytes(3_400),
      durationMs: 3_400,
      reason: 'silence',
    });
  });

  it('aligns a natural cut to a complete frame without cutting below an override minimum', () => {
    const opts = { ...DEFAULT_WINDOW_OPTIONS, minWindowMs: 2_501 };
    const buf = Buffer.concat([pcm(1_000, SPEECH), pcm(1_501, SILENCE)]);
    expect(nextWindowBoundary(buf, opts)).toBeNull();
    const boundary = nextWindowBoundary(Buffer.concat([buf, pcm(19, SILENCE)]), opts);
    expect(boundary?.durationMs).toBe(2_520);
    expect(boundary!.endByte % msToBytes(opts.frameMs)).toBe(0);
  });

  it('flushes quiet audio promptly while preserving the silence and sparse-noise gates', () => {
    const quiet = pcm(2_500, SILENCE);
    expect(nextWindowBoundary(quiet)?.durationMs).toBe(2_500);
    expect(isSilent(quiet)).toBe(true);

    const blip = Buffer.concat([pcm(40, SPEECH), pcm(2_460, SILENCE)]);
    expect(nextWindowBoundary(blip)?.durationMs).toBe(2_500);
    expect(isSilent(blip)).toBe(false);
    expect(speechFraction(blip)).toBeLessThan(DEFAULT_WINDOW_OPTIONS.minSpeechFraction);

    const steadyNoise = pcm(2_500, 300); // below the unchanged RMS threshold
    expect(nextWindowBoundary(steadyNoise)?.durationMs).toBe(2_500);
    expect(isSilent(steadyNoise)).toBe(true);
  });

  it('force-cuts at the max window when there is no gap', () => {
    const b = nextWindowBoundary(pcm(9_000, SPEECH), OPTS);
    expect(b?.reason).toBe('max');
    expect(b?.durationMs).toBe(8_000);
  });

  it('does not wait past the default maximum during sustained speech', () => {
    expect(nextWindowBoundary(pcm(5_980, SPEECH))).toBeNull();
    expect(nextWindowBoundary(pcm(6_000, SPEECH))).toEqual({
      endByte: msToBytes(6_000),
      durationMs: 6_000,
      reason: 'max',
    });
  });

  it('never selects a natural boundary beyond the maximum in a buffered backlog', () => {
    const buf = Buffer.concat([pcm(5_800, SPEECH), pcm(500, SILENCE), pcm(1_000, SPEECH)]);
    const boundary = nextWindowBoundary(buf);
    expect(boundary).toEqual({
      endByte: msToBytes(6_000),
      durationMs: 6_000,
      reason: 'max',
    });
  });

  it('preserves all later speech when an early pause closes a buffered window', () => {
    const first = Buffer.concat([pcm(1_000, SPEECH), pcm(1_500, SILENCE)]);
    const laterSpeech = pcm(4_000, SPEECH);
    const buf = Buffer.concat([first, laterSpeech]);
    const boundary = nextWindowBoundary(buf);
    expect(boundary?.durationMs).toBe(2_500);
    expect(buf.subarray(0, boundary!.endByte).equals(first)).toBe(true);
    expect(buf.subarray(boundary!.endByte).equals(laterSpeech)).toBe(true);
  });

  it('ignores a trailing odd byte and keeps forced cuts sample-aligned for max overrides', () => {
    const opts = { ...DEFAULT_WINDOW_OPTIONS, maxWindowMs: 6_001 };
    const buf = Buffer.concat([pcm(6_001, SPEECH), Buffer.from([255])]);
    expect(nextWindowBoundary(buf, opts)).toEqual({
      endByte: msToBytes(6_001),
      durationMs: 6_001,
      reason: 'max',
    });
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
    expect(o.threshold).toBe(0.015);
    expect(o.minSpeechFraction).toBe(0.05);
  });

  it('applies valid overrides', () => {
    const o = windowOptionsFromEnv({
      LIVE_MIN_WINDOW_MS: '4000',
      LIVE_MAX_WINDOW_MS: '9000',
      LIVE_SILENCE_MS: '800',
      LIVE_VAD_THRESHOLD: '0.025',
      LIVE_MIN_SPEECH_FRACTION: '0.15',
    });
    expect(o.minWindowMs).toBe(4_000);
    expect(o.maxWindowMs).toBe(9_000);
    expect(o.silenceMs).toBe(800);
    expect(o.threshold).toBe(0.025);
    expect(o.minSpeechFraction).toBe(0.15);
  });

  it('falls back on out-of-range noise knobs', () => {
    const o = windowOptionsFromEnv({ LIVE_VAD_THRESHOLD: '9', LIVE_MIN_SPEECH_FRACTION: '2' });
    expect(o.threshold).toBe(0.015);
    expect(o.minSpeechFraction).toBe(0.05);
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
