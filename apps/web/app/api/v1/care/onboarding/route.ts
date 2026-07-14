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

    // CG6 — gift-a-session attribution: a valid, non-self code links the
    // referral and gives the FRIEND's first week a third session (one
    // 7-day credit). The referrer's credit waits for the friend's
    // completed intake — value received, not mere signup.
    if (v.referralCode) {
      const referrer = await tx.careUser.findUnique({
        where: { referralCode: v.referralCode },
        select: { id: true },
      });
      if (referrer && referrer.id !== auth.value.careUserId) {
        const existing = await tx.careReferral.findUnique({
          where: { redeemerCareUserId: auth.value.careUserId },
          select: { id: true },
        });
        if (!existing) {
          const referral = await tx.careReferral.create({
            data: {
              referrerCareUserId: referrer.id,
              redeemerCareUserId: auth.value.careUserId,
            },
          });
          await tx.careSessionCredit.create({
            data: {
              careUserId: auth.value.careUserId,
              expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            },
          });
          await writeAudit(
            {
              actorType: 'CLIENT',
              action: 'CARE_REFERRAL_LINKED',
              targetType: 'CareReferral',
              targetId: referral.id,
              metadata: { ...auditMetadataFromRequest(req), referrerCareUserId: referrer.id },
            },
            tx,
          );
        }
      }
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
