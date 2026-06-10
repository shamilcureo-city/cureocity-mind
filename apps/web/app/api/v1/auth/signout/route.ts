import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/signout — clear the session cookie and bounce to
 * /login. A GET with a side effect is deliberate: the sidebar's
 * "Sign out" is a plain link, and the only state changed is the
 * caller's own cookie.
 */
export function GET(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
