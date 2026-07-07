import { TARGET_SAMPLE_RATE_HZ } from './types';

/**
 * Sprint 77 — voice-activity silence trim.
 *
 * A pure, streaming transform that collapses long silences out of a mono
 * Float32 sample stream (at TARGET_SAMPLE_RATE_HZ) before it reaches the
 * chunker. Every second of removed silence is a second of audio we don't pay
 * Gemini Flash to transcribe (Pass 1 audio-in is the single largest cost
 * line).
 *
 * Design goals, in priority order:
 *   1. NEVER clip speech. Classification is per short analysis frame; a frame
 *      with any energy above the threshold is kept whole. Onsets/offsets that
 *      land mid-frame are preserved because the whole frame survives.
 *   2. Only collapse silences LONGER than `minSilenceMs`. Short natural pauses
 *      (breaths, turn-taking) pass through byte-for-byte.
 *   3. Keep `paddingMs` of silence on each edge of a collapsed gap so word
 *      boundaries and the natural decay/onset around speech are intact.
 *
 * It is deliberately conservative and DEFAULT-OFF at every call site — the
 * energy threshold is microphone/room dependent, so a candidate config must
 * pass a transcript-fidelity spot-check before it's enabled in production.
 *
 * Usage (mirrors PcmChunker / PolyphaseDecimator):
 *   const trim = new SilenceTrimmer();
 *   for (const slice of sliced) out.push(...trim.process(slice));
 *   out.push(...trim.flush());
 */
export interface SilenceTrimOptions {
  /** Sample rate of the incoming stream. Default TARGET_SAMPLE_RATE_HZ. */
  sampleRate?: number;
  /** Analysis-frame length in ms. Default 20 ms. */
  frameMs?: number;
  /**
   * RMS amplitude (0..1) at or above which a frame is "speech". Default
   * 0.008 (~ -42 dBFS) — conservative; tune per device before enabling.
   */
  thresholdRms?: number;
  /** Only collapse silence runs LONGER than this. Default 2000 ms. */
  minSilenceMs?: number;
  /** Silence kept on each edge of a collapsed gap. Default 300 ms. */
  paddingMs?: number;
}

export interface SilenceTrimStats {
  inputSamples: number;
  outputSamples: number;
  droppedSamples: number;
}

const EMPTY = new Float32Array(0);

export class SilenceTrimmer {
  private readonly frameSamples: number;
  private readonly thresholdRms: number;
  private readonly minSilenceSamples: number;
  private readonly padSamples: number;

  /** Partial-frame accumulator (samples not yet forming a full frame). */
  private readonly frameAcc: Float32Array;
  private frameAccLen = 0;

  // Silence-run state.
  private inSilence = false;
  private runSamples = 0;
  private collapsing = false;
  /** Verbatim frames of the current run — only retained while !collapsing. */
  private silenceFrames: Float32Array[] = [];
  /** First frames of the run, until they cover `padSamples` (lead padding). */
  private leadFrames: Float32Array[] = [];
  private leadLen = 0;
  /** Rolling minimal suffix of the run covering `padSamples` (trail padding). */
  private trailFrames: Float32Array[] = [];
  private trailLen = 0;

  private stats: SilenceTrimStats = {
    inputSamples: 0,
    outputSamples: 0,
    droppedSamples: 0,
  };

  constructor(opts: SilenceTrimOptions = {}) {
    const sr = opts.sampleRate ?? TARGET_SAMPLE_RATE_HZ;
    const frameMs = opts.frameMs ?? 20;
    const minSilenceMs = opts.minSilenceMs ?? 2000;
    const paddingMs = opts.paddingMs ?? 300;

    this.frameSamples = Math.max(1, Math.round((frameMs / 1000) * sr));
    this.thresholdRms = opts.thresholdRms ?? 0.008;
    this.minSilenceSamples = Math.max(this.frameSamples, Math.round((minSilenceMs / 1000) * sr));
    // Clamp padding so lead + trail can never overlap (guarantees net trim).
    const maxPad = Math.floor(this.minSilenceSamples / 2);
    this.padSamples = Math.min(Math.max(0, Math.round((paddingMs / 1000) * sr)), maxPad);
    this.frameAcc = new Float32Array(this.frameSamples);
  }

  /** Feed samples; returns the (possibly trimmed) samples to forward downstream. */
  process(samples: Float32Array): Float32Array {
    if (samples.length === 0) return EMPTY;
    this.stats.inputSamples += samples.length;

    const out: Float32Array[] = [];
    let cursor = 0;
    while (cursor < samples.length) {
      const space = this.frameSamples - this.frameAccLen;
      const take = Math.min(space, samples.length - cursor);
      this.frameAcc.set(samples.subarray(cursor, cursor + take), this.frameAccLen);
      this.frameAccLen += take;
      cursor += take;
      if (this.frameAccLen === this.frameSamples) {
        const frame = this.frameAcc.slice(0, this.frameSamples);
        this.frameAccLen = 0;
        const emitted = this.routeFrame(frame);
        if (emitted.length) out.push(emitted);
      }
    }
    return concat(out);
  }

  /** Flush the trailing partial frame and any retained silence. */
  flush(): Float32Array {
    const out: Float32Array[] = [];
    if (this.frameAccLen > 0) {
      const frame = this.frameAcc.slice(0, this.frameAccLen);
      this.frameAccLen = 0;
      const emitted = this.routeFrame(frame);
      if (emitted.length) out.push(emitted);
    }
    if (this.inSilence) {
      out.push(this.closeSilence());
    }
    return concat(out);
  }

  getStats(): SilenceTrimStats {
    return { ...this.stats };
  }

  // --------------------------------------------------------------------------

  private routeFrame(frame: Float32Array): Float32Array {
    if (rms(frame) >= this.thresholdRms) {
      // Speech frame — flush any retained silence first, then keep it whole.
      const retained = this.inSilence ? this.closeSilence() : EMPTY;
      this.stats.outputSamples += frame.length;
      return retained.length ? concat([retained, frame]) : frame;
    }
    // Silence frame — accumulate; emit nothing until speech resumes or flush.
    this.acceptSilence(frame);
    return EMPTY;
  }

  private acceptSilence(frame: Float32Array): void {
    if (!this.inSilence) {
      this.inSilence = true;
      this.runSamples = 0;
      this.collapsing = false;
      this.silenceFrames = [];
      this.leadFrames = [];
      this.leadLen = 0;
      this.trailFrames = [];
      this.trailLen = 0;
    }
    this.runSamples += frame.length;

    // Lead padding: first frames until they cover padSamples.
    if (this.leadLen < this.padSamples) {
      this.leadFrames.push(frame);
      this.leadLen += frame.length;
    }
    // Trailing padding: keep the minimal suffix of frames covering padSamples.
    this.trailFrames.push(frame);
    this.trailLen += frame.length;
    while (
      this.trailFrames.length > 1 &&
      this.trailLen - this.trailFrames[0]!.length >= this.padSamples
    ) {
      this.trailLen -= this.trailFrames.shift()!.length;
    }

    if (!this.collapsing) {
      if (this.runSamples > this.minSilenceSamples) {
        // Crossed the threshold — this run WILL be collapsed. Drop the
        // verbatim buffer; lead + trail frames are all we still need.
        this.collapsing = true;
        this.silenceFrames = [];
      } else {
        this.silenceFrames.push(frame);
      }
    }
  }

  /** Emit the retained portion of the just-ended silence run and reset. */
  private closeSilence(): Float32Array {
    let retained: Float32Array;
    if (!this.collapsing) {
      // Short pause — keep it verbatim.
      retained = concat(this.silenceFrames);
    } else {
      const lead = firstN(concat(this.leadFrames), this.padSamples);
      const trail = lastN(concat(this.trailFrames), this.padSamples);
      retained = concat([lead, trail]);
    }
    this.stats.outputSamples += retained.length;
    this.stats.droppedSamples += this.runSamples - retained.length;

    this.inSilence = false;
    this.runSamples = 0;
    this.collapsing = false;
    this.silenceFrames = [];
    this.leadFrames = [];
    this.leadLen = 0;
    this.trailFrames = [];
    this.trailLen = 0;
    return retained;
  }
}

// ----------------------------------------------------------------------------

function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i]!;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

function concat(parts: Float32Array[]): Float32Array {
  if (parts.length === 0) return EMPTY;
  if (parts.length === 1) return parts[0]!;
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function firstN(arr: Float32Array, n: number): Float32Array {
  return arr.length <= n ? arr : arr.subarray(0, n);
}

function lastN(arr: Float32Array, n: number): Float32Array {
  return arr.length <= n ? arr : arr.subarray(arr.length - n);
}
