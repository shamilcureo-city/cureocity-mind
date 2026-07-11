import { NextResponse, type NextRequest } from 'next/server';
import { CareSettingsInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** GET /api/v1/care/settings — the profile the settings screen edits. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const u = auth.value.careUser;
  return NextResponse.json({
    displayName: u.displayName,
    personaName: u.personaName,
    voiceName: u.voiceName,
    personaStyle: u.personaStyle,
    preferredLanguage: u.preferredLanguage,
    spokenLanguages: u.spokenLanguages,
    vadSilenceMs: u.vadSilenceMs,
    trustedContactName: u.trustedContactName,
    trustedContactPhone: u.trustedContactPhone,
    planTier: u.planTier,
    status: u.status,
  });
}

/** POST — partial settings update (persona, VAD, languages, contact). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CareSettingsInputSchema);
  if (!input.ok) return input.response;

  const v = input.value;
  await prisma.careUser.update({
    where: { id: auth.value.careUserId },
    data: {
      ...(v.personaName !== undefined ? { personaName: v.personaName } : {}),
      ...(v.voiceName !== undefined ? { voiceName: v.voiceName } : {}),
      ...(v.personaStyle !== undefined ? { personaStyle: v.personaStyle } : {}),
      ...(v.preferredLanguage !== undefined ? { preferredLanguage: v.preferredLanguage } : {}),
      ...(v.spokenLanguages !== undefined ? { spokenLanguages: v.spokenLanguages } : {}),
      ...(v.vadSilenceMs !== undefined ? { vadSilenceMs: v.vadSilenceMs } : {}),
      ...(v.trustedContactName !== undefined ? { trustedContactName: v.trustedContactName } : {}),
      ...(v.trustedContactPhone !== undefined
        ? { trustedContactPhone: v.trustedContactPhone }
        : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE — DPDP self-serve erasure (§13): the account is tombstoned and
 * PII cleared inline; transcripts/reports cascade with the row when the
 * retention sweeper hard-deletes tombstones.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;

  await prisma.$transaction(async (tx) => {
    await tx.careUser.update({
      where: { id: auth.value.careUserId },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        displayName: 'Deleted user',
        phone: null,
        phoneEncrypted: null,
        email: null,
        trustedContactName: null,
        trustedContactPhone: null,
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_ACCOUNT_DELETED',
        targetType: 'CareUser',
        targetId: auth.value.careUserId,
        metadata: auditMetadataFromRequest(req),
      },
      tx,
    );
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set('__session', '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
