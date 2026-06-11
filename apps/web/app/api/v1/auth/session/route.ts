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
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const CreateSessionInputSchema = z.object({
  idToken: z.string().min(1),
  /** Sprint 37 — required for a first-time signup when PILOT_INVITE_REQUIRED=true. */
  inviteCode: z.string().max(64).optional(),
});

/** Thrown inside the signup tx to roll it back with a user-facing reason. */
class InviteRejectedError extends Error {}

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
        const row = await tx.psychologist.create({
          data: {
            firebaseUid: decoded.uid,
            fullName: decoded.name ?? 'New therapist',
            email: decoded.email ?? `${decoded.uid}@unclaimed.cureocity.app`,
            phone: decoded.phone_number ?? `pending:${decoded.uid}`,
            rciNumber: `PENDING-${decoded.uid}`,
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
              via: 'phone-otp-auto-provision',
              inviteGated: inviteRequired,
            },
          },
          tx,
        );
        // Sprint 39 — seat the new therapist as OWNER of a personal clinic.
        await ensurePersonalClinic(tx, { psychologistId: row.id, name: row.fullName });
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
