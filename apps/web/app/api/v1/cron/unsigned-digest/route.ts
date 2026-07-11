import { NextResponse, type NextRequest } from 'next/server';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { shareChannels } from '@/lib/share-channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/cron/unsigned-digest — NEXT3.
 *
 * An unsigned note is a clinical record that doesn't exist yet — the
 * medico-legal exposure the product is meant to close. This daily
 * digest emails each therapist a count of completed sessions whose
 * generated note has sat unsigned for more than a day, with a link to
 * the oldest one. One email per therapist per IST day, deduped through
 * the UNSIGNED_NOTE_DIGEST_SENT audit row (metadata.istDay) — no new
 * schema.
 */
const STALE_AFTER_HOURS = Number(process.env['UNSIGNED_DIGEST_AFTER_HOURS'] ?? 24);

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_AFTER_HOURS * 60 * 60 * 1000);
  const istDay = istDayKey(now);
  const channels = shareChannels();

  // Completed sessions with a generated (COMPLETED) draft but no signed
  // note, whose session ended before the staleness cutoff.
  const unsigned = await prisma.session.findMany({
    where: {
      status: 'COMPLETED',
      endedAt: { not: null, lt: cutoff },
      noteDraft: { status: 'COMPLETED', therapyNote: { is: null } },
    },
    select: { id: true, psychologistId: true, endedAt: true },
    orderBy: { endedAt: 'asc' },
    take: 500,
  });

  const byPsychologist = new Map<string, { count: number; oldestSessionId: string }>();
  for (const s of unsigned) {
    const entry = byPsychologist.get(s.psychologistId);
    if (entry) entry.count++;
    else byPsychologist.set(s.psychologistId, { count: 1, oldestSessionId: s.id });
  }

  const psychologists = await prisma.psychologist.findMany({
    where: { id: { in: [...byPsychologist.keys()] } },
    select: { id: true, email: true, fullName: true },
  });

  // Same convention as the share route: the deployment's own origin.
  const appUrl = req.nextUrl.origin;
  let sentCount = 0;
  let alreadySent = 0;
  const errors: Array<{ psychologistId: string; error: string }> = [];

  for (const psy of psychologists) {
    const entry = byPsychologist.get(psy.id);
    if (!entry) continue;

    if (await digestAlreadySent(psy.id, istDay)) {
      alreadySent++;
      continue;
    }

    const plural = entry.count === 1 ? 'session' : 'sessions';
    try {
      const r = await channels.email.sendEmail({
        to: psy.email,
        subject: `${entry.count} unsigned ${plural} waiting for your signature`,
        textBody: [
          `Hi ${psy.fullName},`,
          '',
          `You have ${entry.count} completed ${plural} with a generated note that is still unsigned after ${STALE_AFTER_HOURS} hours.`,
          'An unsigned note is not yet part of the clinical record — a two-minute review closes it.',
          '',
          `Start with the oldest: ${appUrl}/app/sessions/${entry.oldestSessionId}`,
          '',
          '— Cureocity Mind',
        ].join('\n'),
      });
      if (r.outcome !== 'sent') {
        errors.push({ psychologistId: psy.id, error: r.outcome });
        continue;
      }
    } catch (e) {
      errors.push({ psychologistId: psy.id, error: (e as Error).message });
      continue;
    }

    sentCount++;
    await writeAudit({
      actorType: 'SYSTEM',
      actorPsychologistId: psy.id,
      action: 'UNSIGNED_NOTE_DIGEST_SENT',
      targetType: 'Psychologist',
      targetId: psy.id,
      metadata: {
        istDay,
        unsignedCount: entry.count,
        oldestSessionId: entry.oldestSessionId,
        staleAfterHours: STALE_AFTER_HOURS,
      },
    });
  }

  return NextResponse.json({
    istDay,
    staleAfterHours: STALE_AFTER_HOURS,
    unsignedSessions: unsigned.length,
    therapistsWithBacklog: byPsychologist.size,
    digestsSent: sentCount,
    alreadySent,
    backend: channels.backend,
    errors: errors.slice(0, 50),
  });
}

/** One digest per therapist per IST day — the audit row is the dedupe key. */
async function digestAlreadySent(psychologistId: string, istDay: string): Promise<boolean> {
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const recent = await prisma.auditLog.findMany({
    where: {
      action: 'UNSIGNED_NOTE_DIGEST_SENT',
      actorPsychologistId: psychologistId,
      createdAt: { gte: since },
    },
    select: { metadata: true },
    take: 5,
  });
  return recent.some((r) => {
    const m = r.metadata;
    return !!m && typeof m === 'object' && (m as Record<string, unknown>)['istDay'] === istDay;
  });
}

/** YYYY-MM-DD in IST (UTC+5:30, no DST). */
function istDayKey(at: Date): string {
  const ist = new Date(at.getTime() + (5 * 60 + 30) * 60_000);
  return ist.toISOString().slice(0, 10);
}

function isAuthorized(req: NextRequest): boolean {
  // Fail closed (AUD1 pattern): CRON_SECRET must be set and presented.
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — refusing all cron invocations (fail closed).');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
