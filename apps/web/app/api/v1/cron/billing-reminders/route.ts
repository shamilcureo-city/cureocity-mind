import { NextResponse, type NextRequest } from 'next/server';
import { PLAN_CATALOG, planTierLabel, isPaidPlan, type AuditAction } from '@cureocity/contracts';
import { writeAudit } from '@/lib/audit';
import { planAmountInr } from '@/lib/billing';
import {
  daysSinceExpiry,
  daysUntil,
  dunningCopy,
  reminderDayFor,
  renewalCopy,
  type RenewalCopy,
} from '@/lib/billing-reminders';
import { prisma } from '@/lib/prisma';
import { shareChannels } from '@/lib/share-channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/cron/billing-reminders — Sprint 56.
 *
 * Daily renewal-lifecycle pass over every active/lapsed paid
 * BillingAccount. One loop, two outcomes per account:
 *
 *   pre-expiry  (paidThroughAt in the future): 7/3/1-day RENEWAL reminder
 *               (Lever 4 #1, BILLING_REMINDER_SENT).
 *   post-lapse  (paidThroughAt within the last 10 days): 1/3/7-day
 *               DUNNING nudge (Lever 4 #5, BILLING_DUNNING_SENT) to
 *               recover a therapist who let the plan slip.
 *
 * CANCELLED accounts are skipped (they opted out). Razorpay is
 * one-time-orders, so there's no card to auto-retry — dunning is a
 * "come back and renew" email/WhatsApp, not a charge retry.
 *
 * Idempotency: NO new schema. Each send writes an audit row whose
 * metadata {day, paidThroughAtMs} is the dedupe key; the pre-send check
 * scans the same. A renewal that bumps paidThroughAt forward resets the
 * cycle (different paidThroughAtMs).
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET. Channels fall back
 * to Noop when env is unset (dev/CI-safe).
 */
const DUNNING_WINDOW_DAYS = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const channels = shareChannels();
  const dunningFloor = new Date(now.getTime() - DUNNING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // One query covers both passes: paidThroughAt in the future (reminder)
  // OR within the recent lapse window (dunning). CANCELLED opted out.
  const accounts = await prisma.billingAccount.findMany({
    where: {
      plan: { not: 'FREE_TRIAL' },
      status: { not: 'CANCELLED' },
      paidThroughAt: { gt: dunningFloor },
    },
  });
  const psychologists = await prisma.psychologist.findMany({
    where: { id: { in: accounts.map((a) => a.psychologistId) } },
    select: { id: true, email: true, phone: true },
  });
  const psyById = new Map(psychologists.map((p) => [p.id, p] as const));

  const considered = accounts.length;
  const sent = { reminder: 0, dunning: 0, email: 0, whatsapp: 0, skipped: 0, alreadySent: 0 };
  const errors: Array<{ psychologistId: string; channel: string; error: string }> = [];

  for (const a of accounts) {
    if (!a.paidThroughAt || !isPaidPlan(a.plan)) {
      sent.skipped++;
      continue;
    }
    const psy = psyById.get(a.psychologistId);
    if (!psy) {
      sent.skipped++;
      continue;
    }

    // Bucket by sign: future → reminder, past → dunning.
    const future = a.paidThroughAt.getTime() > now.getTime();
    const day = future
      ? reminderDayFor(daysUntil(a.paidThroughAt, now))
      : reminderDayFor(daysSinceExpiry(a.paidThroughAt, now));
    if (day === null) {
      sent.skipped++;
      continue;
    }
    const action: AuditAction = future ? 'BILLING_REMINDER_SENT' : 'BILLING_DUNNING_SENT';
    const paidThroughAtMs = a.paidThroughAt.getTime();

    if (await alreadySent(a.psychologistId, action, day, paidThroughAtMs, now)) {
      sent.alreadySent++;
      continue;
    }

    const tierLabel = planTierLabel(a.plan);
    const amountInr = planAmountInr(a.plan);
    const copy: RenewalCopy = future
      ? renewalCopy({ day, tierLabel, renewalDate: a.paidThroughAt, amountInr })
      : dunningCopy({ day, tierLabel, lapsedDate: a.paidThroughAt, amountInr });

    const result = await dispatch({
      channels,
      email: psy.email,
      phone: psy.phone,
      copy,
      errors,
      ctx: a.psychologistId,
    });
    if (result.email) sent.email++;
    if (result.whatsapp) sent.whatsapp++;

    if (result.email || result.whatsapp) {
      if (future) sent.reminder++;
      else sent.dunning++;
      // Both verbs are written with a literal string so the audit-coverage
      // chaos test can find the writer:
      if (action === 'BILLING_REMINDER_SENT') {
        await writeAudit({
          actorType: 'SYSTEM',
          actorPsychologistId: a.psychologistId,
          action: 'BILLING_REMINDER_SENT',
          targetType: 'BillingAccount',
          targetId: a.id,
          metadata: {
            day,
            paidThroughAtMs,
            plan: a.plan,
            tier: PLAN_CATALOG[a.plan].tier,
            channels: { email: result.email, whatsapp: result.whatsapp },
          },
        });
      } else {
        await writeAudit({
          actorType: 'SYSTEM',
          actorPsychologistId: a.psychologistId,
          action: 'BILLING_DUNNING_SENT',
          targetType: 'BillingAccount',
          targetId: a.id,
          metadata: {
            day,
            paidThroughAtMs,
            plan: a.plan,
            tier: PLAN_CATALOG[a.plan].tier,
            channels: { email: result.email, whatsapp: result.whatsapp },
          },
        });
      }
    }
  }

  return NextResponse.json({
    now: now.toISOString(),
    backend: channels.backend,
    considered,
    sent,
    errors: errors.slice(0, 50),
  });
}

/** Dedupe: has a matching audit row for (action, day, paidThroughAt) landed recently? */
async function alreadySent(
  psychologistId: string,
  action: AuditAction,
  day: number,
  paidThroughAtMs: number,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const recent = await prisma.auditLog.findMany({
    where: { action, actorPsychologistId: psychologistId, createdAt: { gte: since } },
    select: { metadata: true },
    take: 15,
  });
  return recent.some((r) => {
    const m = r.metadata;
    if (!m || typeof m !== 'object') return false;
    const o = m as Record<string, unknown>;
    return o['day'] === day && o['paidThroughAtMs'] === paidThroughAtMs;
  });
}

interface DispatchArgs {
  channels: ReturnType<typeof shareChannels>;
  email: string;
  phone: string;
  copy: RenewalCopy;
  errors: Array<{ psychologistId: string; channel: string; error: string }>;
  ctx: string;
}

/** Send email (always) + WhatsApp (if wired); returns which channels went out. */
async function dispatch({
  channels,
  email,
  phone,
  copy,
  errors,
  ctx,
}: DispatchArgs): Promise<{ email: boolean; whatsapp: boolean }> {
  let emailSent = false;
  let whatsappSent = false;
  try {
    const r = await channels.email.sendEmail({
      to: email,
      subject: copy.subject,
      textBody: copy.textBody,
    });
    if (r.outcome === 'sent') emailSent = true;
    else errors.push({ psychologistId: ctx, channel: 'email', error: r.outcome });
  } catch (e) {
    errors.push({ psychologistId: ctx, channel: 'email', error: (e as Error).message });
  }
  if (channels.whatsappReady && phone) {
    try {
      const r = await channels.messaging.sendWhatsApp({
        to: phone,
        templateName: copy.whatsappTemplate,
        templateParams: copy.whatsappParams,
      });
      if (r.outcome === 'sent') whatsappSent = true;
      else errors.push({ psychologistId: ctx, channel: 'whatsapp', error: r.outcome });
    } catch (e) {
      errors.push({ psychologistId: ctx, channel: 'whatsapp', error: (e as Error).message });
    }
  }
  return { email: emailSent, whatsapp: whatsappSent };
}

function isAuthorized(req: NextRequest): boolean {
  // AUD1 — fail closed: CRON_SECRET must be set, and every invocation must
  // carry it. Vercel automatically sends `Authorization: Bearer $CRON_SECRET`
  // on scheduled invocations when the env var exists, so the x-vercel-cron
  // header alone is no longer sufficient (defense in depth if the app is
  // ever fronted differently).
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — refusing all cron invocations (fail closed).');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
