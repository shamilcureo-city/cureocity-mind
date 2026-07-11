import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { CareUser } from '@prisma/client';
import { firebaseAuth } from './firebase-admin';
import { isAuthBypassed, SESSION_COOKIE_NAME } from './auth-server';
import { DEV_BYPASS_CARE_FIREBASE_UID } from './care-auth';
import { prisma } from './prisma';

/**
 * Server-component (page) counterparts of the care route guards — the
 * /care mirror of auth-page.ts. Failure mode is a redirect to
 * /care/login (pages can't return a 401 body).
 */

export async function currentCareUser(): Promise<CareUser | null> {
  let firebaseUid: string;

  if (isAuthBypassed()) {
    firebaseUid = DEV_BYPASS_CARE_FIREBASE_UID;
  } else {
    const auth = firebaseAuth();
    if (!auth) return null; // production fail-closed
    const jar = await cookies();
    const cookie = jar.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie) return null;
    try {
      const decoded = await auth.verifySessionCookie(cookie, true);
      firebaseUid = decoded.uid;
    } catch {
      return null;
    }
  }

  let user = await prisma.careUser.findUnique({ where: { firebaseUid } });
  if (!user && isAuthBypassed() && firebaseUid === DEV_BYPASS_CARE_FIREBASE_UID) {
    // Dev-only: the demo care user materialises on first touch (same
    // behaviour as the API guard) so /care runs with zero seeding.
    user = await prisma.careUser.create({
      data: {
        firebaseUid: DEV_BYPASS_CARE_FIREBASE_UID,
        displayName: 'Kavya',
        preferredLanguage: 'en',
        spokenLanguages: ['ml', 'en'],
      },
    });
  }
  if (!user || user.status === 'DELETED' || user.deletedAt !== null) return null;
  return user;
}

/** Page guard: resolved CareUser, or a redirect to /care/login. */
export async function requirePageCareUser(): Promise<CareUser> {
  const user = await currentCareUser();
  if (!user) redirect('/care/login');
  return user;
}

/**
 * Primary guard for the authed /care surface: bounces not-yet-onboarded
 * users into onboarding. The onboarding page itself must use
 * requirePageCareUser (not this) to avoid an infinite redirect.
 */
export async function requireOnboardedCareUser(): Promise<CareUser> {
  const user = await requirePageCareUser();
  if (user.onboardedAt === null) redirect('/care/onboarding');
  return user;
}
