import { NextResponse, type NextRequest } from 'next/server';
import { CareOnboardingInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { crisisResources } from '@/lib/care-safety';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const CARE_CONSENT_VERSION = 'CARE_CONSENT_V1';

/**
 * POST /api/v1/care/onboarding (AC1) — persona pick, languages, 18+ +
 * consent attestations, the baseline safety question, trusted contact.
 *
 * §2 layer 2: answering YES to "are you currently having thoughts of
 * harming yourself" still completes onboarding (consent captured, persona
 * saved) but sets a SAFETY_HOLD — the client routes to hotlines + the
 * licensed-therapist bridge, never into an AI session.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CareOnboardingInputSchema);
  if (!input.ok) return input.response;

  const v = input.value;
  const now = new Date();
  const held = v.hasActiveSelfHarmThoughts;

  await prisma.$transaction(async (tx) => {
    await tx.careUser.update({
      where: { id: auth.value.careUserId },
      data: {
        displayName: v.displayName,
        personaName: v.personaName,
        voiceName: v.voiceName,
        personaStyle: v.personaStyle,
        preferredLanguage: v.preferredLanguage,
        spokenLanguages: v.spokenLanguages,
        trustedContactName: v.trustedContactName ?? null,
        trustedContactPhone: v.trustedContactPhone ?? null,
        onboardedAt: now,
        consentVersion: CARE_CONSENT_VERSION,
        consentAt: now,
        ...(held ? { status: 'SAFETY_HOLD', safetyHoldAt: now } : {}),
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_CONSENT_CAPTURED',
        targetType: 'CareUser',
        targetId: auth.value.careUserId,
        metadata: { ...auditMetadataFromRequest(req), consentVersion: CARE_CONSENT_VERSION },
      },
      tx,
    );
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_ONBOARDING_COMPLETED',
        targetType: 'CareUser',
        targetId: auth.value.careUserId,
        metadata: { personaName: v.personaName, voiceName: v.voiceName, held },
      },
      tx,
    );
    if (held) {
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'CARE_SAFETY_HOLD_SET',
          targetType: 'CareUser',
          targetId: auth.value.careUserId,
          metadata: { cause: 'ONBOARDING_BASELINE_GATE' },
        },
        tx,
      );
    }
  });

  if (held) {
    return NextResponse.json({
      status: 'SAFETY_HOLD',
      resources: crisisResources(v.spokenLanguages ?? []),
    });
  }
  return NextResponse.json({ status: 'ONBOARDED' });
}
