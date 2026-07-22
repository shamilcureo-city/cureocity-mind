/**
 * Three products, one platform — the host → product map.
 *
 * Each product fronts the same Next.js app on its own domain; the
 * middleware rewrites the landing route per host and everything else
 * (auth, app, api) is shared. This module is the ONE place that knows
 * which domain is which product — middleware, layouts, and onboarding
 * all read from here.
 *
 * Unknown hosts (localhost, *.vercel.app previews, the bare project
 * domain) fall back to MIND so nothing changes for existing URLs.
 */

export type ProductKey = 'mind' | 'scribe' | 'care';

export interface Product {
  key: ProductKey;
  /** Public product name, used in titles + chrome. */
  name: string;
  /** The canonical production host for this product. */
  host: string;
  /** The practitioner vertical this product onboards into (null = D2C). */
  vertical: 'THERAPIST' | 'DOCTOR' | null;
  /** Path (in the shared app) that serves this product's landing page. */
  landingPath: string;
}

export const PRODUCTS: Record<ProductKey, Product> = {
  mind: {
    key: 'mind',
    name: 'Cureocity Mind',
    host: 'mind.cureocity.in',
    vertical: 'THERAPIST',
    landingPath: '/',
  },
  scribe: {
    key: 'scribe',
    name: 'Cureocity Scribe',
    host: 'scribe.cureocity.in',
    vertical: 'DOCTOR',
    landingPath: '/for-doctors',
  },
  care: {
    key: 'care',
    name: 'Cureocity Care',
    host: 'care.cureocity.in',
    vertical: null,
    landingPath: '/care',
  },
};

const HOST_TO_PRODUCT: Record<string, ProductKey> = Object.fromEntries(
  Object.values(PRODUCTS).map((p) => [p.host, p.key]),
) as Record<string, ProductKey>;

/**
 * The internal operator console's production host. Deliberately NOT a
 * `Product` (it has no landing / marketing / onboarding vertical) — it's
 * the platform-admin surface, host-gated here and route-gated by
 * `requirePageAdmin` at `/console`. The middleware rewrites this host's
 * `/` to `/console`; everything else on the host serves normally.
 *
 * Reaching it over the subdomain in prod additionally needs (a) DNS + a
 * Vercel domain for this host, and (b) `SESSION_COOKIE_DOMAIN=.cureocity.in`
 * so the practitioner login cookie is shared across subdomains. Until then
 * the console is always reachable at the `/console` path on any host.
 */
export const ADMIN_CONSOLE_HOST = 'admin.cureocity.in';

export function isAdminConsoleHost(host: string | null | undefined): boolean {
  const bare = (host ?? '').toLowerCase().split(':')[0] ?? '';
  return bare === ADMIN_CONSOLE_HOST;
}

/**
 * Resolve the product for a request host. Ports are stripped; unknown
 * hosts resolve to MIND (the original product — previews, localhost, and
 * the bare vercel.app domain keep today's behaviour exactly).
 */
export function productFromHost(host: string | null | undefined): Product {
  const bare = (host ?? '').toLowerCase().split(':')[0] ?? '';
  return PRODUCTS[HOST_TO_PRODUCT[bare] ?? 'mind'];
}
