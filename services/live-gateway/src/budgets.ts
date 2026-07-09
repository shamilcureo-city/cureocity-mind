import type { MeterSummary } from '@cureocity/contracts';

/**
 * Sprint DS8 — the §0.3 latency + cost budgets, regression-checked against a
 * consult's meter. The meter (DS0) measures what the gateway can measure
 * per window: transcription (Pass 1) + note (Pass 2) latency percentiles +
 * the running ₹ cost. Those map onto the plan's budgets as below.
 *
 * The reasoning-update (≤ 8 s) and final-note-after-End (≤ 15 s) budgets in
 * §0.3 need their own timers (the reasoning loop + finalize), not carried by
 * the meter — tracked in DS9 instrumentation, noted here so the mapping is
 * explicit rather than silently missing.
 */
export const LATENCY_BUDGETS = {
  /**
   * DOC-9 — the REAL "transcript visible ≤ 2 s from speech" budget, judged
   * against the honest speech→transcript latency (window-wait + pump + Pass-1
   * call). This is the number that matters to the doctor; with the current
   * VAD windowing it is 7–15 s, so this check correctly reports a BREACH
   * instead of the old green. The genuine fix is streaming ASR — until then
   * this keeps the meter from lying.
   */
  speechToTranscriptP95Ms: 2_000,
  /**
   * Pass-1 CALL latency ≤ 2 s — a sub-metric (is the model call itself fast?),
   * NOT the lived speech→transcript latency. Kept for diagnosis but no longer
   * the headline transcript budget (that's speechToTranscriptP95Ms above).
   */
  transcriptP95Ms: 2_000,
  /** Note pass (Pass 2) p95 — the per-window LLM latency proxy. */
  noteP95Ms: 8_000,
  /** LLM cost per consult — the ₹3 hard ceiling (₹2 target). */
  costInrCeiling: 3,
} as const;

export interface BudgetBreach {
  metric: string;
  actual: number;
  budget: number;
}

export interface BudgetCheck {
  ok: boolean;
  breaches: BudgetBreach[];
}

/** Check a consult's meter against the budgets; lists every breach. */
export function checkLatencyBudget(meter: MeterSummary): BudgetCheck {
  const breaches: BudgetBreach[] = [];
  const test = (metric: string, actual: number, budget: number): void => {
    if (actual > budget) breaches.push({ metric, actual, budget });
  };
  // DOC-9 — check the HONEST speech→transcript latency first; it's the one
  // the ≤2s target is really about. Fall back to 0 for pre-DOC-9 rows (no
  // sample → no breach) so old metrics don't spuriously alert.
  test(
    'speechToTranscriptP95Ms',
    meter.speechToTranscriptP95Ms,
    LATENCY_BUDGETS.speechToTranscriptP95Ms,
  );
  test('transcriptP95Ms', meter.transcriptP95Ms, LATENCY_BUDGETS.transcriptP95Ms);
  test('noteP95Ms', meter.noteP95Ms, LATENCY_BUDGETS.noteP95Ms);
  test('costInr', meter.costInr, LATENCY_BUDGETS.costInrCeiling);
  return { ok: breaches.length === 0, breaches };
}

/** One-line human-readable summary for the CLI / logs. */
export function formatBudgetCheck(meter: MeterSummary): string {
  const { ok, breaches } = checkLatencyBudget(meter);
  const head =
    `speech→transcript p95 ${meter.speechToTranscriptP95Ms}ms ` +
    `(pass1 call ${meter.transcriptP95Ms}ms) · note p95 ${meter.noteP95Ms}ms · ` +
    `₹${meter.costInr.toFixed(2)}/consult`;
  if (ok) return `BUDGET OK — ${head}`;
  return (
    `BUDGET BREACH — ${head}\n` +
    breaches.map((b) => `  ✗ ${b.metric} ${b.actual} > ${b.budget}`).join('\n')
  );
}
