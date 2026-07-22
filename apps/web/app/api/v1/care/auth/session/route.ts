import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  isAuthBypassed,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
  sessionCookieDomain,
} from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { firebaseAuth } from '@/lib/firebase-admin';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const CreateCareSessionInputSchema = z.object({
  idToken: z.string().min(1),
  /** Optional display name hint from the signup form (pre-onboarding). */
  displayName: z.string().max(80).optional(),
});

/**
 * POST /api/v1/care/auth/session — the CARE-audience sign-in mint (AC1).
 *
 * Deliberately separate from /api/v1/auth/session: that route auto-
 * provisions Psychologists (with invites, clinics, referral attribution);
 * this one provisions CareUsers and nothing else. The cookie transport is
 * the same Firebase session cookie — the guards separate the audiences by
 * which table the uid resolves through, so a care cookie can never act as
 * a therapist and vice versa (cross-audience tests assert this).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (isAuthBypassed()) {
    return NextResponse.json({ ok: true, bypass: true, registered: false });
  }
  const auth = firebaseAuth();
  if (!auth) {
    return NextResponse.json(
      { error: 'Authentication is not configured on this deployment' },
      { status: 503 },
    );
  }
  const input = await parseJson(req, CreateCareSessionInputSchema);
  if (!input.ok) return input.response;

  let decoded: { uid: string; phone_number?: string; email?: string };
  try {
    decoded = await auth.verifyIdToken(input.value.idToken);
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  let careUser = await prisma.careUser.findUnique({
    where: { firebaseUid: decoded.uid },
    select: { id: true, status: true, onboardedAt: true },
  });
  if (careUser?.status === 'DELETED') {
    return NextResponse.json({ error: 'This account has been deleted' }, { status: 403 });
  }

  let registered = false;
  if (!careUser) {
    careUser = await prisma.$transaction(async (tx) => {
      const created = await tx.careUser.create({
        data: {
          firebaseUid: decoded.uid,
          displayName: input.value.displayName?.trim() || 'Friend',
          phone: decoded.phone_number ?? null,
          email: decoded.email ?? null,
        },
        select: { id: true, status: true, onboardedAt: true },
      });
      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'CARE_USER_REGISTERED',
          targetType: 'CareUser',
          targetId: created.id,
          metadata: auditMetadataFromRequest(req),
        },
        tx,
      );
      return created;
    });
    registered = true;
  }

  let sessionCookie: string;
  try {
    sessionCookie = await auth.createSessionCookie(input.value.idToken, {
      expiresIn: SESSION_COOKIE_MAX_AGE_MS,
    });
  } catch {
    return NextResponse.json({ error: 'Token too old — sign in again' }, { status: 401 });
  }

  const res = NextResponse.json({
    ok: true,
    registered,
    onboarded: careUser.onboardedAt !== null,
  });
  res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: sessionCookieDomain(),
    maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
  });
  return res;
}

/** DELETE — sign out of the care surface (clears the shared cookie). */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  // Domain must match the set (see the shared-cookie note in the signout route).
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    domain: sessionCookieDomain(),
    maxAge: 0,
  });
  return res;
}
