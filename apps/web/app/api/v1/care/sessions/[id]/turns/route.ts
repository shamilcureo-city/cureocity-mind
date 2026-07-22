import { NextResponse, type NextRequest } from 'next/server';
import { MirrorTurnsInputSchema, type CareTurn } from '@cureocity/contracts';
import { CARE_SESSION_CAP_MIN } from '@cureocity/llm';
import { requireCareUserId } from '@/lib/care-auth';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Grace beyond the session cap before turn-mirroring is refused. */
const EXPIRY_GRACE_MS = 5 * 60 * 1000;

/**
 * POST /api/v1/care/sessions/[id]/turns (AC3 §4.6) —
 * the batched transcript mirror. Every finished transcription turn lands
 * here; the server appends (deduped on seq — the mirrored copy is the
 * ONLY transcript Pass 10 reads). Crisis support is user-initiated via the
 * "Need urgent help?" button (POST /crisis); there is no automatic
 * escalation on this path.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;
  const input = await parseJson(req, MirrorTurnsInputSchema);
  if (!input.ok) return input.response;

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: {
      id: true,
      careUserId: true,
      kind: true,
      status: true,
      startedAt: true,
      liveTranscript: true,
    },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status === 'CRISIS_ESCALATED') {
    return NextResponse.json({ action: 'crisis_stop' });
  }
  if (session.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: `Session is ${session.status}` }, { status: 409 });
  }
  // Defense in depth: the ephemeral token TTL is the primary cap; the
  // mirror refuses to grow the record after cap + grace.
  const capMs = CARE_SESSION_CAP_MIN[session.kind] * 60_000;
  if (session.startedAt && Date.now() > session.startedAt.getTime() + capMs + EXPIRY_GRACE_MS) {
    return NextResponse.json({ error: 'Session time is over' }, { status: 410 });
  }

  const existing = (
    Array.isArray(session.liveTranscript) ? session.liveTranscript : []
  ) as CareTurn[];
  const seen = new Set(existing.map((t) => t.seq));
  const fresh = input.value.turns.filter((t) => !seen.has(t.seq));
  if (fresh.length > 0) {
    await prisma.careSession.update({
      where: { id: careSessionId },
      data: { liveTranscript: [...existing, ...fresh] as unknown as object },
    });
  }

  // Crisis support is user-initiated: the "Need urgent help?" button in the
  // live UI routes to POST /crisis (escalateCareSession + CrisisTakeover).
  // There is deliberately NO automatic keyword/model escalation here — the
  // deterministic substring screen fired on the AI's own risk-screen question
  // and on users' *denials* ("no thoughts of harming myself"), ending healthy
  // sessions and locking accounts. An already-escalated session is short-
  // circuited above (status === 'CRISIS_ESCALATED').
  return NextResponse.json({ action: 'continue' });
}
