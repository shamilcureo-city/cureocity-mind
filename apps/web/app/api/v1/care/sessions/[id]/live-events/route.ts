import { NextResponse, type NextRequest } from 'next/server';
import { MirrorLiveEventsInputSchema } from '@cureocity/contracts';
import { requireCareUserId } from '@/lib/care-auth';
import { writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/care/sessions/[id]/live-events (CP2) — the live structure
 * engine's mirror. Every silent tool signal (phase marks, key moments,
 * worksheet fields, homework-as-agreed) lands here on the client's 3s flush
 * cadence; the server appends idempotently by (careSessionId, seq). Pass 13
 * stitches these rows into the report input, so the report is grounded in
 * the work that actually happened. Events are accepted while the session is
 * IN_PROGRESS and after it completes (the final flush races completion).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;
  const input = await parseJson(req, MirrorLiveEventsInputSchema);
  if (!input.ok) return input.response;

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: { id: true, careUserId: true, status: true },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status === 'CREATED') {
    return NextResponse.json({ error: 'Session has not started' }, { status: 409 });
  }

  const events = input.value.events;
  const { count } = await prisma.careLiveEvent.createMany({
    data: events.map((e) => ({
      careSessionId,
      seq: e.seq,
      type: e.type,
      payload: e.payload as object,
      atMs: e.atMs,
    })),
    skipDuplicates: true,
  });

  // CP2 audit — the clinically meaningful signals get their own action; the
  // rest of the batch is recorded once. Literal strings in if-blocks (never
  // ternaries) so the audit-coverage chaos test discovers every writer.
  for (const e of events) {
    if (e.type === 'AGENDA_SET') {
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'CARE_LIVE_AGENDA_SET',
        targetType: 'CareSession',
        targetId: careSessionId,
        metadata: { seq: e.seq },
      });
    }
    if (e.type === 'MOMENT_LOGGED') {
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'CARE_LIVE_MOMENT_LOGGED',
        targetType: 'CareSession',
        targetId: careSessionId,
        metadata: { seq: e.seq },
      });
    }
    if (e.type === 'HOMEWORK_ASSIGNED') {
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'CARE_LIVE_HOMEWORK_AGREED',
        targetType: 'CareSession',
        targetId: careSessionId,
        metadata: { seq: e.seq },
      });
    }
  }
  if (count > 0) {
    await writeAudit({
      actorType: 'SYSTEM',
      action: 'CARE_LIVE_EVENT_RECORDED',
      targetType: 'CareSession',
      targetId: careSessionId,
      metadata: { persisted: count, batch: events.length },
    });
  }

  return NextResponse.json({ persisted: count });
}
