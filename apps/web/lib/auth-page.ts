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
 * Page guard for cross-tenant admin surfaces (e.g. the competency
 * dashboard, which lists every therapist's stats). Non-admins are
 * bounced to their own dashboard rather than shown an error.
 */
export async function requirePageAdmin(): Promise<Psychologist> {
  const psy = await requirePagePsychologist();
  if (psy.role !== 'ADMIN') redirect('/app');
  return psy;
}
