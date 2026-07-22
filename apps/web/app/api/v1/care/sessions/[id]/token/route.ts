import { NextResponse, type NextRequest } from 'next/server';
import { RedeemLiveTokenInputSchema } from '@cureocity/contracts';
import { requireCareUserId } from '@/lib/care-auth';
import { buildSessionPrompt, getCareCaseFile } from '@/lib/care-case-file';
import { mintLiveCredential } from '@/lib/care-live-token';
import { takeStartToken } from '@/lib/care-live-store';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/v1/care/sessions/[id]/token (AC3, §4.2) — SINGLE-USE redeem
 * of the start token for the live credential. The system prompt (the
 * case file!) is assembled here, server-side, at the last moment — it
 * rides inside the credential/setup, never in a page payload.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;
  const input = await parseJson(req, RedeemLiveTokenInputSchema);
  if (!input.ok) return input.response;

  const stored = await takeStartToken(input.value.startToken);
  if (
    !stored ||
    stored.careSessionId !== careSessionId ||
    stored.careUserId !== auth.value.careUserId ||
    stored.expiresAtMs < Date.now()
  ) {
    return NextResponse.json(
      { error: 'Start token is invalid, expired, or already used' },
      { status: 401 },
    );
  }

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: { id: true, careUserId: true, kind: true, status: true, topic: true, moodBefore: true },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'CREATED' && session.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { error: `Session is ${session.status} — start a new one` },
      { status: 409 },
    );
  }

  const { careUser } = auth.value;
  const caseFile = await getCareCaseFile(auth.value.careUserId);
  // CP2 — the live structure engine (phase rail) is a server flag, default off.
  const structureEnabled = process.env['CARE_LIVE_STRUCTURE'] === 'true';
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
    structureEnabled,
  });

  const credential = await mintLiveCredential({
    voiceName: careUser.voiceName,
    vadSilenceMs: careUser.vadSilenceMs,
    systemInstruction: prompt,
    sessionCapMin,
    structure: structureEnabled,
  });

  if (session.status === 'CREATED') {
    await prisma.careSession.update({
      where: { id: careSessionId },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  }

  return NextResponse.json(credential);
}
