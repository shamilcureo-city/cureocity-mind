import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, sessionCookieDomain } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/care/auth/signout — clear the session cookie and bounce
 * to the /care landing.
 *
 * The care-scoped twin of /api/v1/auth/signout: Care reuses the same
 * `__session` cookie transport (resolved through care_users), so signing
 * out is the same cookie-clear — but a care user should land back on
 * /care, not the practitioner /login. Clearing the shared cookie signs
 * the browser out of every audience, which is the correct behaviour for
 * an explicit sign-out.
 *
 * Why POST (not GET): a GET link is prefetched by Next.js, which would
 * clear the session cookie out from under a live user. POST is never
 * prefetched, so the side effect only fires on an explicit form submit.
 * Status 303 so the browser follows the redirect with a GET.
 */
export function POST(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/care', req.url), 303);
  // Same `domain` as the practitioner writers — the shared `__session` cookie
  // can only be DELETED by a Set-Cookie whose name+domain+path all match, so a
  // domain-scoped cookie (SESSION_COOKIE_DOMAIN set) needs the domain here too
  // or this "sign out of every audience" clear silently leaves it behind.
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    domain: sessionCookieDomain(),
    maxAge: 0,
  });
  return res;
}
