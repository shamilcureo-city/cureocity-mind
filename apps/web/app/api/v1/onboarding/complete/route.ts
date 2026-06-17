import { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toPsychologist } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { sendWelcomeEmail } from '@/lib/welcome-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint 31 — onboarding completion.
 *
 * The general-purpose PATCH /api/v1/psychologists/me intentionally
 * rejects email / phone / RCI changes (those require re-verification
 * flows). Onboarding has a one-shot exception: a freshly auto-
 * provisioned account replaces its placeholder identity fields here,
 * atomically with `onboardingCompletedAt`. After that, the same
 * fields are read-only via the normal PATCH.
 *
 * Re-runs are blocked (409) — the form is gated, and once the
 * timestamp is set, edits move to the regular settings PATCH.
 */

// Matches the regex used by the Sprint 18 UpdatePsychologistInputSchema
// (kept private in @cureocity/contracts/psychologist.ts).
const Iso639InlineSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'must be an ISO 639-1 code');

const OnboardingCompleteSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(320),
  rciNumber: z
    .string()
    .trim()
    .min(3)
    .max(40)
    // Reject the placeholder pattern even if a clever user re-submits it.
    .refine((v) => !v.startsWith('PENDING-'), {
      message: 'Enter your real RCI registration number',
    }),
  defaultOutputLanguage: Iso639InlineSchema,
  /// Optional E.164 phone. Honoured ONLY when the current row's phone is
  /// still the `pending:<uid>` placeholder (Google/email signup path) —
  /// real OTP-verified phones can't be changed here.
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{8,15}$/, 'must be in E.164 format (e.g. +919876543210)')
    .optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, OnboardingCompleteSchema);
  if (!input.ok) return input.response;

  const me = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: { onboardingCompletedAt: true, phone: true },
  });
  if (!me) return NextResponse.json({ error: 'Psychologist not found' }, { status: 404 });
  if (me.onboardingCompletedAt !== null) {
    return NextResponse.json(
      { error: 'Onboarding already complete — edit via Settings → Account.' },
      { status: 409 },
    );
  }

  const phoneIsPlaceholder = me.phone.startsWith('pending:');
  const willUpdatePhone = phoneIsPlaceholder && input.value.phone !== undefined;

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.psychologist.update({
        where: { id: auth.value.psychologistId },
        data: {
          fullName: input.value.fullName,
          email: input.value.email.toLowerCase(),
          rciNumber: input.value.rciNumber,
          defaultOutputLanguage: input.value.defaultOutputLanguage,
          ...(willUpdatePhone && { phone: input.value.phone }),
          // status stays PENDING_VERIFICATION until an admin marks the
          // RCI verified (self-attestation gate).
          onboardingCompletedAt: new Date(),
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'PSYCHOLOGIST_UPDATED',
          targetType: 'Psychologist',
          targetId: auth.value.psychologistId,
          metadata: {
            ...auditMetadataFromRequest(req),
            event: 'ONBOARDING_COMPLETED',
            fields: [
              'fullName',
              'email',
              'rciNumber',
              'defaultOutputLanguage',
              ...(willUpdatePhone ? ['phone'] : []),
            ],
          },
        },
        tx,
      );
      return row;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = (e.meta?.['target'] as string[] | undefined)?.[0] ?? 'field';
      const human =
        target === 'email'
          ? 'email'
          : target === 'rciNumber'
            ? 'RCI number'
            : target === 'phone'
              ? 'mobile number'
              : target;
      return NextResponse.json(
        { error: `That ${human} is already used by another account.` },
        { status: 409 },
      );
    }
    throw e;
  }

  // Best-effort welcome email. A transient failure (or noop in dev)
  // must NOT roll back onboarding — log and move on.
  try {
    const res = await sendWelcomeEmail({ to: updated.email, fullName: updated.fullName });
    if (res.outcome !== 'sent') {
      console.warn(
        `[onboarding] welcome email outcome=${res.outcome} code=${res.errorCode ?? ''} for psy=${updated.id}`,
      );
    }
  } catch (e) {
    console.error(`[onboarding] welcome email threw for psy=${updated.id}: ${(e as Error).message}`);
  }

  return NextResponse.json({ psychologist: toPsychologist(updated) });
}
