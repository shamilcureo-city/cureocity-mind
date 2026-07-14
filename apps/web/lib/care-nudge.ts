/**
 * CG4 — the nudge channel policy (docs/CARE_GROWTH_SYSTEM.md §6). Pure
 * function, spec'd like care-gate/care-suppression: given the user's state,
 * decide which single nudge (if any) may go out this hour. The cron and the
 * send helper both consume this — display, enforcement, and audit stay on
 * one implementation.
 *
 * Hard rules (the ethics charter, executable):
 *   - No opt-in → nothing, ever. Consent is a timestamped in-app tap.
 *   - Suppression (the care-suppression predicate) → nothing; the caller
 *     records a SUPPRESSED CareNudge row so the negative is provable.
 *   - Quiet hours: sends only in the user's chosen IST hour (default 21).
 *   - ≤2 proactive sends per trailing 7 days; ≤1 per day.
 *   - The re-engagement ladder fires each rung AT MOST ONCE PER LAPSE
 *     (a rung already sent after the last activity never repeats), and
 *     after day-30's single message the account goes quiet forever —
 *     a promise we keep.
 *   - Message bodies are DISCREET (no clinical vocabulary, no persona
 *     sender) — joint-family lock screens are a disclosure surface. The
 *     actual copy lives in Meta-approved templates; this module only picks
 *     the template kind.
 */

export type CareNudgeKind = 'SESSION_DAY' | 'LADDER_D3' | 'LADDER_D7' | 'LADDER_D30';

export const CARE_NUDGE_DEFAULT_WINDOW_HOUR = 21; // 9pm IST
export const CARE_NUDGE_WEEKLY_MAX = 2;

export interface CareCronNudgeInput {
  /** Timestamped in-app consent — null means never send. */
  whatsappOptInAt: Date | null;
  /** The ONE suppression predicate's verdict (care-suppression.ts). */
  suppress: boolean;
  /** Current IST hour 0–23. */
  istHour: number;
  /** Current IST day-of-week 0(Sun)–6(Sat). */
  istDow: number;
  /** User's chosen send hour (IST); default 21. */
  windowStartHour?: number | null;
  /** User-picked session days (0–6), from "same time next week?". */
  sessionDays?: number[] | null;
  /** Whole days since the user's last check-in or completed session. */
  daysSinceLastActivity: number;
  /** Proactive sends in the trailing 7 days (SENT rows). */
  sentLast7Days: number;
  /** Any nudge already sent today (IST)? */
  sentToday: boolean;
  /** Ladder rungs already sent SINCE the last activity (per-lapse dedupe). */
  ladderSentThisLapse: { d3: boolean; d7: boolean; d30: boolean };
}

export interface CareNudgeDecision {
  kind: CareNudgeKind;
}

export function decideCareCronNudge(input: CareCronNudgeInput): CareNudgeDecision | null {
  if (!input.whatsappOptInAt) return null;
  if (input.suppress) return null;

  const windowHour = input.windowStartHour ?? CARE_NUDGE_DEFAULT_WINDOW_HOUR;
  if (input.istHour !== windowHour) return null;
  if (input.sentToday) return null;
  if (input.sentLast7Days >= CARE_NUDGE_WEEKLY_MAX) return null;

  const d = input.daysSinceLastActivity;

  // Session-day reminder: only for a user who is currently active-ish
  // (yesterday/today gap ≤ 2) — a lapsed user gets the ladder's door-open
  // tone, never a "you and Meera pencilled today in" that reads as guilt.
  const isSessionDay = (input.sessionDays ?? []).includes(input.istDow);
  if (isSessionDay && d <= 2) return { kind: 'SESSION_DAY' };

  // The ladder — each rung once per lapse; silence after day 30.
  if (d >= 30) {
    return input.ladderSentThisLapse.d30 ? null : { kind: 'LADDER_D30' };
  }
  if (d >= 7) {
    return input.ladderSentThisLapse.d7 ? null : { kind: 'LADDER_D7' };
  }
  if (d >= 3) {
    return input.ladderSentThisLapse.d3 ? null : { kind: 'LADDER_D3' };
  }
  return null;
}

/**
 * Template selection — the env vars name Meta-APPROVED WATI templates
 * (approval has days-to-weeks lead time; file on sprint day 1). Missing
 * env → the nudge records as SUPPRESSED 'channel_unconfigured' and the
 * in-app surfaces carry the loop alone.
 */
export function careNudgeTemplate(
  kind: CareNudgeKind | 'REPORT_READY',
): { envVar: string; templateName: string } | null {
  const envVar =
    kind === 'REPORT_READY'
      ? 'CARE_WATI_TEMPLATE_REPORT'
      : kind === 'SESSION_DAY' || kind === 'LADDER_D3'
        ? 'CARE_WATI_TEMPLATE_CHECKIN'
        : 'CARE_WATI_TEMPLATE_DOOR';
  const templateName = process.env[envVar];
  return templateName ? { envVar, templateName } : null;
}
