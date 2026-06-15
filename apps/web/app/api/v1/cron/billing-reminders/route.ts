import { NextResponse, type NextRequest } from 'next/server';
import { PLAN_CATALOG, planTierLabel, isPaidPlan } from '@cureocity/contracts';
import { writeAudit } from '@/lib/audit';
import { planAmountInr } from '@/lib/billing';
import { daysUntil, reminderDayFor, renewalCopy } from '@/lib/billing-reminders';
import { prisma } from '@/lib/prisma';
import { shareChannels } from '@/lib/share-channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/cron/billing-reminders — Sprint 56.
 *
 * Daily renewal-reminder pass over every active paid BillingAccount.
 * For each account whose `paidThroughAt` lands in the 7/3/1-day windows,
 * dispatch an email (SendGrid) + WhatsApp (WATI) reminder once per
 * (account, day, paidThroughAt) tuple.
 *
 * Idempotency: NO new schema. The cron checks for an existing
 * `BILLING_REMINDER_SENT` audit row whose metadata.day +
 * metadata.paidThroughAtMs match the current pairing — if absent, send
 * + audit. A renewal that bumps `paidThroughAt` forward naturally
 * resets the cycle (different metadata.paidThroughAtMs).
 *
 * Auth: x-vercel-cron header (set by Vercel cron) OR Bearer CRON_SECRET.
 * Channel falls back to Noop (logs but doesn't send) when env is unset
 * — same posture as the share routes; safe in dev/CI.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const channels = shareChannels();

  // Pull every account on a paid plan whose paidThroughAt is still in
  // the future (lapsed accounts belong to the dunning path, not here).
  // BillingAccount has no direct `psychologist` relation; resolve in a
  // single companion query keyed by the psychologist ids.
  const accounts = await prisma.billingAccount.findMany({
    // CANCELLED accounts keep access until lapse but opted out of nudges;
    // PAUSED accounts have null paidThroughAt so the date filter skips them.
    where: { plan: { not: 'FREE_TRIAL' }, paidThroughAt: { gt: now }, status: { not: 'CANCELLED' } },
  });
  const psychologists = await prisma.psychologist.findMany({
    where: { id: { in: accounts.map((a) => a.psychologistId) } },
    select: { id: true, email: true, fullName: true, phone: true },
  });
  const psyById = new Map(psychologists.map((p) => [p.id, p] as const));

  const considered = accounts.length;
  const sent = { email: 0, whatsapp: 0, skipped: 0, alreadySent: 0 };
  const errors: Array<{ psychologistId: string; channel: string; error: string }> = [];

  for (const a of accounts) {
    if (!a.paidThroughAt || !isPaidPlan(a.plan)) {
      sent.skipped++;
      continue;
    }
    const psy = psyById.get(a.psychologistId);
    if (!psy) {
      // Orphaned billing row — defensive, shouldn't happen with the
      // unique psychologistId, but skip rather than crash the cron.
      sent.skipped++;
      continue;
    }
    const day = reminderDayFor(daysUntil(a.paidThroughAt, now));
    if (day === null) {
      sent.skipped++;
      continue;
    }
    const paidThroughAtMs = a.paidThroughAt.getTime();

    // Dedupe: have we already audited a reminder for this exact
    // (account, day, paidThroughAt) tuple? Bounded scan over the last
    // 60 days (renewal window is never wider) keeps the
    // (actorPsychologistId, createdAt) index helpful.
    const since = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const recent = await prisma.auditLog.findMany({
      where: {
        action: 'BILLING_REMINDER_SENT',
        actorPsychologistId: a.psychologistId,
        createdAt: { gte: since },
      },
      select: { metadata: true },
      take: 10,
    });
    if (recent.some((r) => matchesDedupe(r.metadata, { day, paidThroughAtMs }))) {
      sent.alreadySent++;
      continue;
    }

    const tierLabel = planTierLabel(a.plan);
    const amountInr = planAmountInr(a.plan);
    const copy = renewalCopy({ day, tierLabel, renewalDate: a.paidThroughAt, amountInr });

    let emailSent = false;
    let whatsappSent = false;

    // Email — primary channel; fires unconditionally if the therapist
    // has an email on file (every Psychologist row has email NOT NULL).
    try {
      const r = await channels.email.sendEmail({
        to: psy.email,
        subject: copy.subject,
        textBody: copy.textBody,
      });
      if (r.outcome === 'sent') {
        emailSent = true;
        sent.email++;
      } else {
        errors.push({
          psychologistId: a.psychologistId,
          channel: 'email',
          error: `${r.outcome}${r.errorCode ? `:${r.errorCode}` : ''}`,
        });
      }
    } catch (e) {
      errors.push({
        psychologistId: a.psychologistId,
        channel: 'email',
        error: (e as Error).message,
      });
    }

    // WhatsApp — only if WATI is wired AND we have a phone. Template
    // params are positional per the pre-approved WhatsApp template.
    if (channels.whatsappReady && psy.phone) {
      try {
        const r = await channels.messaging.sendWhatsApp({
          to: psy.phone,
          templateName: copy.whatsappTemplate,
          templateParams: copy.whatsappParams,
        });
        if (r.outcome === 'sent') {
          whatsappSent = true;
          sent.whatsapp++;
        } else {
          errors.push({
            psychologistId: a.psychologistId,
            channel: 'whatsapp',
            error: `${r.outcome}${r.errorCode ? `:${r.errorCode}` : ''}`,
          });
        }
      } catch (e) {
        errors.push({
          psychologistId: a.psychologistId,
          channel: 'whatsapp',
          error: (e as Error).message,
        });
      }
    }

    // Audit the reminder if ANY channel went out — that's enough to
    // dedupe future runs (we don't want to spam a working channel
    // because a sibling channel transiently failed). The dunning path
    // owns retrying failed channels.
    if (emailSent || whatsappSent) {
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
          channels: { email: emailSent, whatsapp: whatsappSent },
        },
      });
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

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const secret = process.env['CRON_SECRET'];
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * Defensive read of the audit metadata JSON. Prisma's `Json` field is
 * typed `unknown` after select; we only care about two scalar fields.
 */
function matchesDedupe(
  metadata: unknown,
  { day, paidThroughAtMs }: { day: number; paidThroughAtMs: number },
): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const m = metadata as Record<string, unknown>;
  return m['day'] === day && m['paidThroughAtMs'] === paidThroughAtMs;
}
