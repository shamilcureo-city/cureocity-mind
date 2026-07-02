import type { MeterSummary } from '@cureocity/contracts';
import type { GeminiCallLogData } from '@cureocity/llm';

/**
 * Sprint DS0 — the per-consult meter. Every Pass-1 (transcription) and
 * Pass-2 (note) call reports a callLog with token counts + INR cost +
 * latency; this accumulates them and, on demand, emits a MeterSummary the
 * gateway ships to the browser (which relays it to the live-metric route).
 *
 * This is the unit-economics instrument: it tells us whether a real consult
 * stays under ₹2 and whether transcription p95 stays under 2s. It holds no
 * clock of its own — the caller passes wall-clock + backend identity into
 * `summary()` — so it is pure and unit-tests without mocking time.
 */
export class ConsultMeter {
  private windows = 0;
  private pass1Calls = 0;
  private pass2Calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costInr = 0;
  private readonly transcriptLatencies: number[] = [];
  private readonly noteLatencies: number[] = [];
  private readonly pass1InputTokenSamples: number[] = [];

  /** A Pass-1 transcription of one window completed. */
  recordTranscribe(callLog: GeminiCallLogData, latencyMs: number): void {
    this.pass1Calls++;
    this.accumulate(callLog);
    this.transcriptLatencies.push(nonNegInt(latencyMs));
    this.pass1InputTokenSamples.push(callLog.inputTokens);
  }

  /** A Pass-2 note build completed. */
  recordNote(callLog: GeminiCallLogData, latencyMs: number): void {
    this.pass2Calls++;
    this.accumulate(callLog);
    this.noteLatencies.push(nonNegInt(latencyMs));
  }

  /** Count one finalized transcription window. */
  markWindow(): void {
    this.windows++;
  }

  /**
   * Input tokens billed per Pass-1 window, in order. The O(n) acceptance
   * check compares the first and last of these: after windowing they should
   * be within ±20% (each window is bounded), where the old whole-buffer
   * re-run grew every cycle.
   */
  get transcribeInputTokens(): readonly number[] {
    return this.pass1InputTokenSamples;
  }

  private accumulate(c: GeminiCallLogData): void {
    this.inputTokens += c.inputTokens;
    this.outputTokens += c.outputTokens;
    this.costInr += c.costInr;
  }

  summary(sessionId: string, backend: string, elapsedMs: number): MeterSummary {
    return {
      sessionId,
      backend,
      windows: this.windows,
      pass1Calls: this.pass1Calls,
      pass2Calls: this.pass2Calls,
      // Backends may report fractional token estimates (the mock divides by
      // 4); the contract + DB column are integers, so round the totals.
      inputTokens: Math.round(this.inputTokens),
      outputTokens: Math.round(this.outputTokens),
      costInr: round4(this.costInr),
      transcriptP50Ms: percentile(this.transcriptLatencies, 50),
      transcriptP95Ms: percentile(this.transcriptLatencies, 95),
      noteP50Ms: percentile(this.noteLatencies, 50),
      noteP95Ms: percentile(this.noteLatencies, 95),
      elapsedMs: nonNegInt(elapsedMs),
    };
  }
}

/**
 * Nearest-rank percentile over a latency sample set. Empty → 0; a single
 * sample → that sample for every percentile. Deterministic (stable sort).
 */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] ?? 0;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function nonNegInt(n: number): number {
  return Math.max(0, Math.round(n));
}
