/**
 * Sprint DS0 — energy-based voice-activity detection + window segmentation.
 *
 * The live gateway used to re-transcribe the ENTIRE rolling audio buffer on
 * every cycle. That is O(n²) in a long consult: at minute 20 you re-send 20
 * minutes of audio, so per-tick tokens (and cost, and latency) grow without
 * bound. This module lets the session cut the stream into bounded windows at
 * natural silence gaps and transcribe each window exactly once — O(n) total.
 *
 * It is deliberately dependency-free and pure so it unit-tests against
 * synthetic PCM frames. Audio is 16 kHz mono signed-16-bit little-endian,
 * the same wire format the browser streams.
 */

export const SAMPLE_RATE = 16_000;
export const BYTES_PER_SAMPLE = 2; // signed 16-bit LE, mono
const MAX_AMPLITUDE = 32_768;

export interface WindowOptions {
  sampleRate: number;
  /** Sub-frame granularity for the silence scan. */
  frameMs: number;
  /** RMS amplitude (0..1) at/above which a frame counts as speech. */
  threshold: number;
  /** Don't close a window shorter than this. */
  minWindowMs: number;
  /** Force-close a window once it reaches this, even mid-speech. */
  maxWindowMs: number;
  /** A silence gap this long (after minWindow) is a natural boundary. */
  silenceMs: number;
}

/**
 * Defaults tuned for perceived latency (Sprint 74): the window is the
 * dominant term in speech→findings latency — nothing is transcribed or
 * reasoned about until a window closes, so a 15–30 s window meant findings
 * trailed speech by ~30 s (breaching the ≤8 s reasoning-update budget in
 * the DS plan §0.3). 6–12 s windows still cut at natural pauses (silence
 * gap ≥ 600 ms) so utterances stay whole, and total audio tokens are
 * unchanged — the same speech just ships in smaller windows. Tune per
 * deploy via LIVE_MIN_WINDOW_MS / LIVE_MAX_WINDOW_MS / LIVE_SILENCE_MS.
 */
export const DEFAULT_WINDOW_OPTIONS: WindowOptions = {
  sampleRate: SAMPLE_RATE,
  frameMs: 20,
  threshold: 0.015,
  // DS-era default was 6–12 s. Lowered so the transcript follows speech in
  // ~3 s instead of ~6–8 s: the old 6 s floor meant a short utterance had to
  // wait for the window to FILL before it could be transcribed at all, which
  // read as a 4–5 s lag. Utterances still cut at natural pauses; the env
  // overrides below (LIVE_MIN/MAX_WINDOW_MS, LIVE_SILENCE_MS) tune per deploy.
  minWindowMs: 2_500,
  maxWindowMs: 6_000,
  silenceMs: 400,
};

/**
 * Window options with env overrides (LIVE_MIN_WINDOW_MS, LIVE_MAX_WINDOW_MS,
 * LIVE_SILENCE_MS). Each value is validated independently and falls back to
 * the default when absent or out of range; max is always kept ≥ min + 1 s so
 * a partial override can't produce an uncloseable window.
 */
export function windowOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): WindowOptions {
  const readMs = (key: string, fallback: number, lo: number, hi: number): number => {
    const raw = env[key];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < lo || n > hi) return fallback;
    return n;
  };
  const minWindowMs = readMs(
    'LIVE_MIN_WINDOW_MS',
    DEFAULT_WINDOW_OPTIONS.minWindowMs,
    2_000,
    60_000,
  );
  const maxWindowMs = Math.max(
    minWindowMs + 1_000,
    readMs('LIVE_MAX_WINDOW_MS', DEFAULT_WINDOW_OPTIONS.maxWindowMs, 3_000, 120_000),
  );
  const silenceMs = readMs('LIVE_SILENCE_MS', DEFAULT_WINDOW_OPTIONS.silenceMs, 200, 3_000);
  return { ...DEFAULT_WINDOW_OPTIONS, minWindowMs, maxWindowMs, silenceMs };
}

export type WindowReason = 'silence' | 'max';
export interface WindowBoundary {
  /** Byte offset within the passed buffer to cut the window at (exclusive). */
  endByte: number;
  /** Duration of the window in ms. */
  durationMs: number;
  reason: WindowReason;
}

/** Convert a byte length of PCM to its duration in ms. */
export function bytesToMs(bytes: number, sampleRate = SAMPLE_RATE): number {
  const samples = Math.floor(bytes / BYTES_PER_SAMPLE);
  return Math.floor((samples / sampleRate) * 1000);
}

/** Convert a duration in ms to a sample-aligned byte length of PCM. */
export function msToBytes(ms: number, sampleRate = SAMPLE_RATE): number {
  const samples = Math.round((ms / 1000) * sampleRate);
  return samples * BYTES_PER_SAMPLE;
}

/**
 * Root-mean-square amplitude of a PCM buffer, normalised to 0..1. Silence
 * is ~0; speech is typically 0.02–0.3. Ignores a trailing odd byte.
 */
export function rms(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  if (samples === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * BYTES_PER_SAMPLE);
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / samples) / MAX_AMPLITUDE;
}

/**
 * Classify each fixed-length sub-frame as speech (`true`) or silence
 * (`false`) by RMS threshold. The last partial frame is included.
 */
export function classifyFrames(
  pcm: Buffer,
  opts: WindowOptions = DEFAULT_WINDOW_OPTIONS,
): boolean[] {
  const frameBytes = msToBytes(opts.frameMs, opts.sampleRate);
  if (frameBytes <= 0) return [];
  const out: boolean[] = [];
  for (let off = 0; off < pcm.length; off += frameBytes) {
    const frame = pcm.subarray(off, Math.min(off + frameBytes, pcm.length));
    out.push(rms(frame) >= opts.threshold);
  }
  return out;
}

/** True if the whole buffer is below the speech threshold. */
export function isSilent(pcm: Buffer, opts: WindowOptions = DEFAULT_WINDOW_OPTIONS): boolean {
  return rms(pcm) < opts.threshold;
}

/**
 * Given the un-flushed PCM tail, decide whether (and where) to close the
 * next transcription window:
 *
 *   • `null`     — the tail is shorter than `minWindowMs`; keep buffering.
 *   • 'silence'  — a silence gap ≥ `silenceMs` began at/after `minWindowMs`;
 *                  cut at the START of that gap so the window ends on the
 *                  last speech (a clean utterance boundary).
 *   • 'max'      — no natural gap yet but the tail reached `maxWindowMs`;
 *                  force-cut so windows stay bounded (the O(n) guarantee).
 *
 * Pure: same buffer + opts → same boundary. The caller slices `endByte`
 * off the tail, transcribes it, and advances its cursor.
 */
export function nextWindowBoundary(
  pcm: Buffer,
  opts: WindowOptions = DEFAULT_WINDOW_OPTIONS,
): WindowBoundary | null {
  const totalMs = bytesToMs(pcm.length, opts.sampleRate);
  if (totalMs < opts.minWindowMs) return null;

  const frameMs = opts.frameMs;
  const frames = classifyFrames(pcm, opts);
  const neededSilentFrames = Math.max(1, Math.ceil(opts.silenceMs / frameMs));

  let runStart = -1; // frame index where the current silence run began
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i]) {
      if (runStart < 0) runStart = i;
      const runLen = i - runStart + 1;
      const runStartMs = runStart * frameMs;
      if (runLen >= neededSilentFrames && runStartMs >= opts.minWindowMs) {
        // Cut just AFTER the confirmed silence so the window absorbs its own
        // trailing pause and the next window starts clean on speech. Keeps
        // windows uniform for uniform speech+pause cadence.
        const cutMs = (i + 1) * frameMs;
        const endByte = clampToBuffer(msToBytes(cutMs, opts.sampleRate), pcm.length);
        return { endByte, durationMs: bytesToMs(endByte, opts.sampleRate), reason: 'silence' };
      }
    } else {
      runStart = -1;
    }
  }

  if (totalMs >= opts.maxWindowMs) {
    const endByte = clampToBuffer(msToBytes(opts.maxWindowMs, opts.sampleRate), pcm.length);
    return { endByte, durationMs: bytesToMs(endByte, opts.sampleRate), reason: 'max' };
  }
  return null;
}

function clampToBuffer(byte: number, len: number): number {
  if (byte <= 0) return 0;
  // Align to a sample boundary and never exceed the buffer.
  const aligned = byte - (byte % BYTES_PER_SAMPLE);
  return Math.min(aligned, len - (len % BYTES_PER_SAMPLE));
}
