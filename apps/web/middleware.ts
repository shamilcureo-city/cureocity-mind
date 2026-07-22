import { NextResponse, type NextRequest } from 'next/server';
import { PRODUCTS, isAdminConsoleHost, productFromHost } from '@/lib/product';

/**
 * Three products, one platform — host-based routing.
 *
 * scribe.cureocity.in  →  '/' serves the doctor landing (/for-doctors)
 * care.cureocity.in    →  '/' serves the Care landing (/care)
 * mind.cureocity.in    →  unchanged (the original '/'); the live pilot
 *                         never touches this middleware's rewrite paths.
 *
 * Rewrites are internal — the visitor's URL stays clean. On each new
 * host, the old path 308s to '/' so there is exactly one canonical URL
 * per landing. Cross-host canonicalisation FROM mind (mind/for-doctors →
 * the scribe domain, etc.) stays OFF until the new domains have live DNS —
 * flipping it earlier would redirect visitors to hosts that don't
 * resolve yet. Flip CANONICALIZE_FROM_PRIMARY after verifying both new
 * domains load.
 *
 * Never touches /api, /_next, static assets, or the patient portal.
 */

// Flipped ON 2026-07-14 — both product domains verified live on Vercel
// (scribe.cureocity.in + care.cureocity.in serving with certificates).
const CANONICALIZE_FROM_PRIMARY = true;

export function middleware(req: NextRequest): NextResponse {
  const host = req.headers.get('host');
  const { pathname } = req.nextUrl;

  // The operator console fronts its own host. On `admin.cureocity.in`, `/`
  // serves the console overview (`/console`); every deeper path (`/console/*`,
  // `/login`, `/api/*`) is served as-is and never reaches this rewrite (the
  // matcher only runs middleware on `/`). Checked FIRST so this host never
  // falls through to the MIND landing.
  if (isAdminConsoleHost(host)) {
    if (pathname === '/') {
      const url = req.nextUrl.clone();
      url.pathname = '/console';
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  const product = productFromHost(host);

  if (product.key === 'scribe') {
    if (pathname === '/') {
      const url = req.nextUrl.clone();
      url.pathname = '/for-doctors';
      return NextResponse.rewrite(url);
    }
    if (pathname === '/for-doctors') {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url, 308);
    }
    // The Care product doesn't live on the doctor domain. Same-path
    // redirect: the care host serves /care/* paths as-is.
    if (pathname === '/care' || pathname.startsWith('/care/')) {
      return NextResponse.redirect(new URL(pathname, `https://${PRODUCTS.care.host}`), 308);
    }
  }

  if (product.key === 'care') {
    if (pathname === '/') {
      const url = req.nextUrl.clone();
      url.pathname = '/care';
      return NextResponse.rewrite(url);
    }
    if (pathname === '/care') {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url, 308);
    }
    // Practitioner surfaces don't live on the consumer domain.
    if (pathname === '/for-doctors') {
      return NextResponse.redirect(new URL('/', `https://${PRODUCTS.scribe.host}`), 308);
    }
  }

  if (product.key === 'mind' && CANONICALIZE_FROM_PRIMARY) {
    if (pathname === '/for-doctors') {
      return NextResponse.redirect(new URL('/', `https://${PRODUCTS.scribe.host}`), 308);
    }
    if (pathname === '/care' || pathname.startsWith('/care/')) {
      return NextResponse.redirect(new URL(pathname, `https://${PRODUCTS.care.host}`), 308);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Landing + marketing routes only. The app, api, portal, and assets
  // are shared across hosts and never rewritten.
  matcher: ['/', '/for-doctors', '/care/:path*'],
};
