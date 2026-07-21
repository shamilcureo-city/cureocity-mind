import { NextResponse, type NextRequest } from 'next/server';
import { CARE_SESSION_CAP_MIN } from '@cureocity/llm';
import { requireCareUserId } from '@/lib/care-auth';
import { buildSessionPrompt, getCareCaseFile } from '@/lib/care-case-file';
import { mintLiveCredential } from '@/lib/care-live-token';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Grace beyond the session cap before a reconnect is refused. */
const EXPIRY_GRACE_MS = 5 * 60 * 1000;

/**
 * POST /api/v1/care/sessions/[id]/reconnect-token (CP1, docs/CARE_PSYCHOLOGIST.md).
 *
 * Re-mint a live credential for an IN_PROGRESS session whose socket dropped,
 * WITHOUT the (single-use, already-consumed) start token. The browser resumes
 * the conversation by passing the Gemini session-resumption handle in the new
 * setup. This is transport recovery — NOT a new session — so there is no
 * status transition and no consent re-snapshot. Owner-authed and bounded to
 * the session's cap + grace so a stale session can never re-open forever.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: {
      id: true,
      careUserId: true,
      kind: true,
      status: true,
      topic: true,
      moodBefore: true,
      startedAt: true,
    },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: `Session is ${session.status}` }, { status: 409 });
  }
  const capMs = CARE_SESSION_CAP_MIN[session.kind] * 60_000;
  if (session.startedAt && Date.now() > session.startedAt.getTime() + capMs + EXPIRY_GRACE_MS) {
    return NextResponse.json({ error: 'Session time is over' }, { status: 410 });
  }

  const { careUser } = auth.value;
  const caseFile = await getCareCaseFile(auth.value.careUserId);
  const { prompt, sessionCapMin } = buildSessionPrompt({
    displayName: careUser.displayName,
    personaName: careUser.personaName,
    personaStyle: careUser.personaStyle,
    preferredLanguage: careUser.preferredLanguage,
    spokenLanguages: careUser.spokenLanguages,
    kind: session.kind,
    topic: session.topic ?? undefined,
    moodBefore: session.moodBefore ?? undefined,
    caseFile,
  });

  const credential = await mintLiveCredential({
    voiceName: careUser.voiceName,
    vadSilenceMs: careUser.vadSilenceMs,
    systemInstruction: prompt,
    sessionCapMin,
  });
  return NextResponse.json(credential);
}
