import type { Utterance } from '@cureocity/contracts';

/**
 * Sprint DS2 — the reasoning scheduler.
 *
 * The reasoning pass is the expensive one, so we don't fire it on every
 * window. This debounces + coalesces: new utterances queue up, and a batch
 * is released to run when EITHER
 *   - it has been ≥ `minGapMs` since the last run (steady cadence), OR
 *   - the oldest pending utterance has waited ≥ `forceMs` (never starve).
 * Nothing pending → nothing runs. On consult end the caller `flush()`es.
 *
 * Clock is injected so it unit-tests without real time. Monotonic run
 * ordering (drop-superseded results) is enforced by the caller via the
 * CaseState reasoning version — the gateway runs passes sequentially, so a
 * newer batch always reflects everything an older one saw.
 */
export interface SchedulerOptions {
  /** Don't run more often than this. */
  minGapMs: number;
  /** Force a run once the oldest pending utterance is this old. */
  forceMs: number;
}

/**
 * Batch D — the debounce was a NO-OP.
 *
 * `takeDue()` is only called when a VAD window closes, and a window is 6–12s
 * long. With `minGapMs: 4_000` the steady-cadence test had therefore always
 * elapsed by the time it was asked, so the most expensive live pass ran on
 * EVERY window — exactly what this scheduler exists to prevent.
 *
 * The gap now comfortably exceeds `maxWindowMs` (12s), so reasoning runs on
 * roughly every second window instead. That halves the dominant live cost for
 * at most ~10s of extra latency on a suggestion, and `forceMs` still
 * guarantees nothing waits longer than 30s. Both are env-tunable — set
 * LIVE_REASONING_MIN_GAP_MS=0 to restore reasoning-per-window.
 */
export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = {
  minGapMs: 15_000,
  forceMs: 30_000,
};

/** Read the cadence from env, falling back to the defaults above. */
export function schedulerOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SchedulerOptions {
  const num = (key: string, fallback: number, max: number): number => {
    const raw = env[key];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
  };
  const minGapMs = num('LIVE_REASONING_MIN_GAP_MS', DEFAULT_SCHEDULER_OPTIONS.minGapMs, 120_000);
  return {
    minGapMs,
    // forceMs below minGapMs would make the force path fire first and undo
    // the gap entirely; clamp it up.
    forceMs: Math.max(minGapMs, num('LIVE_REASONING_FORCE_MS', DEFAULT_SCHEDULER_OPTIONS.forceMs, 300_000)),
  };
}

export class ReasoningScheduler {
  private pending: Utterance[] = [];
  private lastRunAtMs = 0;
  private firstPendingAtMs = 0;
  private started = false;

  constructor(
    private readonly opts: SchedulerOptions = DEFAULT_SCHEDULER_OPTIONS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Queue an utterance for the next reasoning batch. */
  enqueue(u: Utterance): void {
    if (this.pending.length === 0) this.firstPendingAtMs = this.now();
    this.pending.push(u);
  }

  /**
   * Return the batch to run now, or `null` to keep waiting. On the first
   * ever call with pending work we run immediately (no cold-start delay).
   */
  takeDue(): Utterance[] | null {
    if (this.pending.length === 0) return null;
    const now = this.now();
    const dueBySteady = !this.started || now - this.lastRunAtMs >= this.opts.minGapMs;
    const dueByForce = now - this.firstPendingAtMs >= this.opts.forceMs;
    if (dueBySteady || dueByForce) return this.release(now);
    return null;
  }

  /** Release everything pending regardless of timing (consult end). */
  flush(): Utterance[] {
    if (this.pending.length === 0) return [];
    return this.release(this.now());
  }

  private release(now: number): Utterance[] {
    const batch = this.pending;
    this.pending = [];
    this.lastRunAtMs = now;
    this.started = true;
    return batch;
  }
}
