import { NextResponse, type NextRequest } from 'next/server';
import { MirrorTurnsInputSchema, type CareTurn } from '@cureocity/contracts';
import { screenForCrisis } from '@cureocity/clinical';
import { CARE_SESSION_CAP_MIN } from '@cureocity/llm';
import { requireCareUserId } from '@/lib/care-auth';
import { escalateCareSession } from '@/lib/care-safety';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Grace beyond the session cap before turn-mirroring is refused. */
const EXPIRY_GRACE_MS = 5 * 60 * 1000;

/**
 * POST /api/v1/care/sessions/[id]/turns (AC3 §4.6, AC6 §2 layer 4a) —
 * the batched transcript mirror. Every finished transcription turn lands
 * here; the server appends (deduped on seq — the mirrored copy is the
 * ONLY transcript Pass 10 reads) and runs the deterministic crisis
 * screen on the batch. A hit escalates server-side FIRST, then tells the
 * client to hard-stop: `{action: 'crisis_stop'}`.
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

  // §2 layer 4a — deterministic, zero-LLM, every batch. Screen ONLY the
  // USER's turns. The therapist is an AI conducting a real intake and is
  // explicitly instructed to ask the risk-screen question ("any thoughts of
  // harming yourself?"), so its OWN turns necessarily contain phrases from
  // the crisis list. Screening them self-terminated every session that
  // reached the risk screen and put the account on a 12h SAFETY_HOLD. The
  // user's own disclosures stay fully screened here; a crisis the model
  // itself detects comes in through its flag_crisis tool (the /crisis route).
  const screen = screenForCrisis(fresh.filter((t) => t.role === 'user').map((t) => t.text));
  if (screen.hit) {
    await escalateCareSession({
      careSessionId,
      careUserId: auth.value.careUserId,
      source: 'keyword_screen',
      metadata: {
        matches: screen.matches.slice(0, 10) as unknown as Record<string, unknown>[],
      },
    });
    return NextResponse.json({ action: 'crisis_stop' });
  }

  return NextResponse.json({ action: 'continue' });
}
