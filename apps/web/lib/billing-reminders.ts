/**
 * Sprint 56 — billing-reminder helpers (pure functions, no I/O).
 *
 * The renewal-reminder cron is a thin wrapper that runs the day-bucket
 * logic over every active paid BillingAccount once a day. Keeping the
 * bucket logic and copy out of the route file means it's deterministic
 * and self-evident — and if we ever add unit tests for apps/web, this
 * is the surface to cover.
 */

export type ReminderDay = 7 | 3 | 1;

/**
 * Map "calendar days until renewal" to the reminder bucket this run
 * should fire, accounting for missed cron days. Returns null when no
 * reminder is due in this run.
 *
 * Bucketing:
 *   - daysUntilExpiry in {7, 8} → day-7 reminder (catches a missed day-8 run)
 *   - daysUntilExpiry in {3, 4} → day-3 reminder
 *   - daysUntilExpiry in {1, 2} → day-1 reminder
 *
 * daysUntilExpiry <= 0 means already lapsed — handled by the dunning
 * path (Lever 4 #5, not this sprint), so we don't ping again here.
 */
export function reminderDayFor(daysUntilExpiry: number): ReminderDay | null {
  if (daysUntilExpiry >= 7 && daysUntilExpiry <= 8) return 7;
  if (daysUntilExpiry >= 3 && daysUntilExpiry <= 4) return 3;
  if (daysUntilExpiry >= 1 && daysUntilExpiry <= 2) return 1;
  return null;
}

/** Days until `paidThroughAt` from `now`, rounded UP. 0 = today, negative = past. */
export function daysUntil(paidThroughAt: Date, now: Date): number {
  const ms = paidThroughAt.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export interface RenewalCopy {
  subject: string;
  textBody: string;
  /** WATI template name; pre-approved by WhatsApp Business. */
  whatsappTemplate: string;
  /** Positional template params: [tierLabel, daysLeft, renewalDate]. */
  whatsappParams: [string, string, string];
}

export function renewalCopy({
  day,
  tierLabel,
  renewalDate,
  amountInr,
}: {
  day: ReminderDay;
  tierLabel: string;
  renewalDate: Date;
  amountInr: number;
}): RenewalCopy {
  const dateStr = renewalDate.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const subjectLead =
    day === 7
      ? `Your ${tierLabel} plan renews in 7 days`
      : day === 3
        ? `${tierLabel} renews in 3 days`
        : `${tierLabel} renews tomorrow`;
  const textBody = [
    `Hi from Cureocity Mind,`,
    ``,
    `Your ${tierLabel} plan renews on ${dateStr} (₹${amountInr.toLocaleString('en-IN')}).`,
    ``,
    day === 1
      ? `If your card is up to date, the renewal will go through automatically. If anything needs updating, head to Settings → Plan in the app.`
      : `If you'd like to switch tiers or change billing interval, open Settings → Plan in the app before then.`,
    ``,
    `— The Cureocity Mind team`,
  ].join('\n');
  return {
    subject: subjectLead,
    textBody,
    whatsappTemplate:
      process.env['WATI_TEMPLATE_RENEWAL_REMINDER'] ?? 'cureocity_renewal_reminder',
    whatsappParams: [tierLabel, String(day), dateStr],
  };
}
