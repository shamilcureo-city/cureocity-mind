import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/signout — clear the session cookie and bounce to
 * /login.
 *
 * Why POST (not GET): the sidebar previously rendered Sign out as a plain
 * <Link href="/api/v1/auth/signout">. Next.js prefetches every Link on
 * screen by default, so the sign-out URL was being fetched as soon as the
 * sidebar mounted (or the user hovered nearby) — clearing the session
 * cookie out from under a live user and producing the "rapid sidebar
 * clicks bounce me to login" symptom that survived several false-positive
 * fixes. POST is never prefetched by browsers or Next, so the side effect
 * only fires on an explicit form submit.
 *
 * Status 303 (See Other) on the redirect so the browser follows it with
 * a GET to /login (not a POST), which is the correct semantic.
 */
export function POST(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  res.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
