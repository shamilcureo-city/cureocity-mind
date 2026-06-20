import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Psychologist } from '@prisma/client';
import { firebaseAuth } from './firebase-admin';
import { SESSION_COOKIE_NAME, bypassFirebaseUid, isAuthBypassed } from './auth-server';
import { prisma } from './prisma';

/**
 * Server-component (page) counterparts of the route guards in
 * auth-server.ts. Pages can't return a NextResponse, so the failure
 * mode is a redirect to /login instead of a 401/403 JSON body.
 *
 * Identity rides on the `__session` Firebase session cookie minted by
 * POST /api/v1/auth/session. In bypass mode (dev/preview/explicit
 * demo) this resolves to the seeded fixture, same as the API guards —
 * so local dev and demo deployments keep working with zero setup.
 */

export async function currentPsychologist(): Promise<Psychologist | null> {
  let firebaseUid: string;

  if (isAuthBypassed()) {
    firebaseUid = bypassFirebaseUid();
  } else {
    const auth = firebaseAuth();
    if (!auth) return null; // production fail-closed — no demo fallback
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

  const psy = await prisma.psychologist.findUnique({ where: { firebaseUid } });
  if (!psy || psy.deletedAt !== null) return null;
  return psy;
}

/** Page guard: resolved Psychologist row, or a redirect to /login. */
export async function requirePagePsychologist(): Promise<Psychologist> {
  const psy = await currentPsychologist();
  if (!psy) redirect('/login');
  return psy;
}

/**
 * Sprint 31 — primary page guard for `/app/*`. Bounces signed-in but
 * not-yet-onboarded therapists to the onboarding form so the rest of
 * the app never sees placeholder identity fields.
 *
 * The onboarding page itself must use `requirePagePsychologist` (not
 * this helper) to avoid an infinite redirect.
 */
export async function requireOnboardedPsychologist(): Promise<Psychologist> {
  const psy = await requirePagePsychologist();
  if (psy.onboardingCompletedAt === null) redirect('/onboarding');
  return psy;
}

/**
 * Page guard for cross-tenant admin surfaces (e.g. the competency
 * dashboard, which lists every therapist's stats). Non-admins are
 * bounced to their own dashboard rather than shown an error.
 * Implies onboarded — admins use the same forms.
 */
export async function requirePageAdmin(): Promise<Psychologist> {
  const psy = await requireOnboardedPsychologist();
  if (psy.role !== 'ADMIN') redirect('/app');
  return psy;
}

/**
 * Sprint DV1 — vertical page guards. A doctor account and a therapist
 * account are mutually exclusive; these bounce a signed-in user who
 * lands on the wrong vertical's surface back to /app (their own home).
 * Both imply onboarded. See docs/DOCTOR_VERTICAL.md.
 */
export async function requireOnboardedDoctor(): Promise<Psychologist> {
  const psy = await requireOnboardedPsychologist();
  if (psy.vertical !== 'DOCTOR') redirect('/app');
  return psy;
}

export async function requireOnboardedTherapist(): Promise<Psychologist> {
  const psy = await requireOnboardedPsychologist();
  if (psy.vertical !== 'THERAPIST') redirect('/app');
  return psy;
}
