/**
 * CG3 — Care price constants (docs/CARE_GROWTH_SYSTEM.md §7). Env-overridable
 * like the weekly caps (care-gate.ts), so a pilot can tune without a deploy.
 * Prices are anchored against the ₹800–3,500 human-therapy session — ALWAYS
 * rendered with the non-equivalence line ("Care is an AI, not a replacement
 * for a therapist — that's part of why it costs less").
 */

function priceFromEnv(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Care Plus — prepaid 30 days, no auto-renewal. */
export function carePlusMonthlyInr(): number {
  return priceFromEnv('CARE_PLUS_MONTHLY_INR', 599);
}

/** Days a Plus purchase buys. */
export const CARE_PLUS_PERIOD_DAYS = 30;
