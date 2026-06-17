import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
  isAuthBypassed,
} from '@/lib/auth-server';
import { writeAudit } from '@/lib/audit';
import { ensurePersonalClinic } from '@/lib/clinic';
import { firebaseAuth } from '@/lib/firebase-admin';
import { isPilotInviteRequired, redeemInviteCode } from '@/lib/invite';
import { redeemReferralAtSignup } from '@/lib/referral';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint 56 (Lever 3a) — acquisition attribution captured at signup.
 * Marketing site forwards UTM params from the landing URL to this body
 * so the funnel dashboard can attribute signups to the artefact / channel
 * / campaign that drove them. All fields optional; bounded length so a
 * malicious caller can't bloat the JSON column.
 */
const AcquisitionUtmSchema = z
  .object({
    utm_source: z.string().max(64).optional(),
    utm_medium: z.string().max(64).optional(),
    utm_campaign: z.string().max(128).optional(),
    referrer: z.string().max(2048).optional(),
  })
  .strip();

const CreateSessionInputSchema = z.object({
  idToken: z.string().min(1),
  /** Sprint 37 — required for a first-time signup when PILOT_INVITE_REQUIRED=true. */
  inviteCode: z.string().max(64).optional(),
  /** Sprint 56 — optional UTM bundle from the marketing landing page. */
  acquisitionUtm: AcquisitionUtmSchema.optional(),
  /** Sprint 56 (Lever 3b) — optional peer referral code from ?ref=. */
  referralCode: z.string().max(32).optional(),
});

/** Thrown inside the signup tx to roll it back with a user-facing reason. */
class InviteRejectedError extends Error {}

/**
 * Sprint 56 ops — auto-grant ADMIN to a new signup whose email is in the
 * comma-separated BOOTSTRAP_ADMIN_EMAILS env. Solves the chicken-and-egg
 * where the first real account (post-bypass) provisions as THERAPIST and
 * can't reach /app/admin/* without manual SQL. Case-insensitive match;
 * empty/unset env = nobody is auto-promoted.
 */
function isBootstrapAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const allow = (process.env['BOOTSTRAP_ADMIN_EMAILS'] ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

/**
 * POST /api/v1/auth/session — exchange a Firebase id token (from the
 * phone-OTP login) for an httpOnly session cookie, auto-provisioning
 * a Psychologist row on first sign-in.
 *
 * This IS the signup flow: a brand-new verified phone number gets a
 * PENDING_VERIFICATION Psychologist with placeholder unique fields
 * (email / RCI number), completed later in Settings → Account. The
 * provision is audited as PSYCHOLOGIST_REGISTERED.
 *
 * Server pages + every same-origin fetch from client components ride
 * on the cookie — no Bearer-token plumbing in the UI.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Demo/dev bypass: no cookie needed — the guards resolve the seeded
  // fixture on every request. Report success so the login page's flow
  // is identical in both modes.
  if (isAuthBypassed()) {
    return NextResponse.json({ ok: true, bypass: true });
  }

  const auth = firebaseAuth();
  if (!auth) {
    return NextResponse.json(
      { error: 'Authentication is not configured on this deployment' },
      { status: 503 },
    );
  }

  const input = await parseJson(req, CreateSessionInputSchema);
  if (!input.ok) return input.response;

  let decoded: { uid: string; phone_number?: string; name?: string; email?: string };
  try {
    decoded = await auth.verifyIdToken(input.value.idToken);
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  let psy = await prisma.psychologist.findUnique({
    where: { firebaseUid: decoded.uid },
    select: { id: true, deletedAt: true },
  });
  let registered = false;

  if (psy?.deletedAt) {
    return NextResponse.json({ error: 'This account has been deleted' }, { status: 403 });
  }

  if (!psy) {
    // First sign-in: auto-provision (this IS the signup). Sprint 37 —
    // when PILOT_INVITE_REQUIRED is on, a valid invite code is required
    // and is redeemed atomically with the psychologist create, so a
    // failed/raced redeem rolls back the whole signup (no orphan row).
    const inviteRequired = isPilotInviteRequired();
    try {
      const created = await prisma.$transaction(async (tx) => {
        if (inviteRequired) {
          const redeemed = await redeemInviteCode(tx, input.value.inviteCode ?? '');
          if (!redeemed.ok) throw new InviteRejectedError(redeemed.reason);
        }
        const bootstrapAdmin = isBootstrapAdminEmail(decoded.email);
        const row = await tx.psychologist.create({
          data: {
            firebaseUid: decoded.uid,
            fullName: decoded.name ?? 'New therapist',
            email: decoded.email ?? `${decoded.uid}@unclaimed.cureocity.app`,
            phone: decoded.phone_number ?? `pending:${decoded.uid}`,
            rciNumber: `PENDING-${decoded.uid}`,
            // Sprint 56 ops — auto-admin for bootstrap emails (env-gated).
            ...(bootstrapAdmin && { role: 'ADMIN' as const }),
            // Sprint 56 — only persist if at least one field is set, so a
            // bare {} doesn't drown the signal in the funnel dashboard.
            acquisitionUtm:
              input.value.acquisitionUtm && Object.keys(input.value.acquisitionUtm).length > 0
                ? input.value.acquisitionUtm
                : undefined,
          },
          select: { id: true, deletedAt: true, fullName: true },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: row.id,
            action: 'PSYCHOLOGIST_REGISTERED',
            targetType: 'Psychologist',
            targetId: row.id,
            metadata: {
              via: 'auth-session-auto-provision',
              inviteGated: inviteRequired,
              bootstrapAdmin,
            },
          },
          tx,
        );
        // Sprint 39 — seat the new therapist as OWNER of a personal clinic.
        await ensurePersonalClinic(tx, { psychologistId: row.id, name: row.fullName });
        // Sprint 56 (Lever 3b) — redeem a referral code if present. The
        // referred therapist gets a free Pro month; a bad code is a quiet
        // no-op (never rolls back the signup).
        if (input.value.referralCode) {
          const acct = await tx.billingAccount.create({ data: { psychologistId: row.id } });
          const redeemed = await redeemReferralAtSignup(tx, {
            code: input.value.referralCode,
            referredPsychologistId: row.id,
            billingAccountId: acct.id,
            now: new Date(),
          });
          if (redeemed) {
            await writeAudit(
              {
                actorType: 'PSYCHOLOGIST',
                actorPsychologistId: row.id,
                action: 'REFERRAL_REDEEMED',
                targetType: 'Psychologist',
                targetId: row.id,
                metadata: {
                  code: input.value.referralCode.trim().toUpperCase(),
                  referrerPsychologistId: redeemed.referrerPsychologistId,
                },
              },
              tx,
            );
          }
        }
        if (inviteRequired) {
          await writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: row.id,
              action: 'PILOT_INVITE_REDEEMED',
              targetType: 'Psychologist',
              targetId: row.id,
              metadata: { code: (input.value.inviteCode ?? '').trim().toUpperCase() },
            },
            tx,
          );
        }
        return row;
      });
      psy = created;
      registered = true;
    } catch (e) {
      if (e instanceof InviteRejectedError) {
        return NextResponse.json({ error: e.message, code: 'INVITE_REQUIRED' }, { status: 403 });
      }
      throw e;
    }
  }

  let sessionCookie: string;
  try {
    sessionCookie = await auth.createSessionCookie(input.value.idToken, {
      expiresIn: SESSION_COOKIE_MAX_AGE_MS,
    });
  } catch {
    // Firebase rejects id tokens older than 5 minutes for cookie
    // minting — the login page calls this immediately after confirm,
    // so this is a stale/replayed token.
    return NextResponse.json({ error: 'Token too old — sign in again' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, registered });
  res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
  });
  return res;
}

/** DELETE /api/v1/auth/session — sign out (clear the cookie). */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
