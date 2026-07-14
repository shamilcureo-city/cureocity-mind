import { NextResponse, type NextRequest } from 'next/server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * PROD8 — GET /api/v1/care/export — the DPDP §11 access right the
 * onboarding consent has promised since AC1 ("I can export or delete
 * everything in Settings") without an implementation behind it.
 *
 * Returns everything Cureocity holds about the Care user as one JSON
 * document: profile, consent record, plans, every session (with the
 * mirrored transcript and its report), check-ins, and instrument
 * responses. Downloaded via the Settings screen; audited as
 * CARE_DATA_EXPORTED. Read-only — a GET with an audit row, like the
 * portal-open receipt.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUserId } = auth.value;

  // The auth helper carries a narrowed selection — the export needs the
  // full row (contact fields, consent record, timestamps).
  const careUser = await prisma.careUser.findUniqueOrThrow({ where: { id: careUserId } });

  const [plans, sessions, checkins, instruments] = await Promise.all([
    prisma.carePlan.findMany({
      where: { careUserId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.careSession.findMany({
      where: { careUserId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        status: true,
        topic: true,
        moodBefore: true,
        moodAfter: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
        liveTranscript: true,
        crisisAt: true,
        crisisSource: true,
        createdAt: true,
        report: { select: { kind: true, body: true, riskLevel: true, createdAt: true } },
      },
    }),
    prisma.careCheckin.findMany({ where: { careUserId }, orderBy: { createdAt: 'asc' } }),
    prisma.careInstrumentResponse.findMany({
      where: { careUserId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const exported = {
    exportedAt: new Date().toISOString(),
    product: 'Cureocity Care',
    profile: {
      displayName: careUser.displayName,
      phone: careUser.phone,
      email: careUser.email,
      preferredLanguage: careUser.preferredLanguage,
      spokenLanguages: careUser.spokenLanguages,
      personaName: careUser.personaName,
      voiceName: careUser.voiceName,
      personaStyle: careUser.personaStyle,
      trustedContactName: careUser.trustedContactName,
      trustedContactPhone: careUser.trustedContactPhone,
      planTier: careUser.planTier,
      status: careUser.status,
      onboardedAt: careUser.onboardedAt,
      consentVersion: careUser.consentVersion,
      consentAt: careUser.consentAt,
      createdAt: careUser.createdAt,
    },
    plans,
    sessions,
    checkins,
    instruments,
  };

  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_DATA_EXPORTED',
    targetType: 'CareUser',
    targetId: careUserId,
    metadata: {
      ...auditMetadataFromRequest(req),
      sessions: sessions.length,
      plans: plans.length,
      checkins: checkins.length,
    },
  });

  return new NextResponse(JSON.stringify(exported, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="cureocity-care-export-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
