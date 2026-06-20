'use client';

import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase-therapist';

/**
 * Bearer-token self-heal for every authenticated client request.
 *
 * Mounted once at the top of the /app shell. It wraps window.fetch so
 * that every same-origin /api/v1 request carries the signed-in
 * therapist's Firebase id token as an `Authorization: Bearer` header.
 * The API guards accept EITHER the `__session` cookie OR a Bearer token
 * (apps/web/lib/auth-server.ts), so this makes client requests work even
 * when the cookie isn't sent on a fetch — the failure mode behind
 * "Missing Bearer token or session" on Start intake, draft loads, etc.
 *
 * Purely additive:
 *   - the cookie still rides along (credentials are untouched),
 *   - an existing Authorization header is never overwritten,
 *   - non-/api/v1 requests and signed-out requests pass through unchanged,
 *   - any failure falls back to the original, unmodified fetch.
 *
 * The patch is installed during render (guarded + idempotent) rather than
 * in an effect, because a parent's effect runs AFTER its children's — so
 * an effect-time install would miss child components that fetch on mount
 * (the draft loader is one). Render-time install is in place before any
 * descendant renders. SSR-safe via the `typeof window` guard.
 *
 * Note: OnboardingForm keeps its own inline self-heal — /onboarding is
 * outside this layout.
 */
let installed = false;

function isApiRequest(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;
    return path.startsWith('/api/v1');
  } catch {
    return false;
  }
}

function installAuthedFetch(): void {
  if (typeof window === 'undefined' || installed) return;
  if (!isFirebaseConfigured()) return;
  installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isApiRequest(input)) return original(input, init);
    try {
      const user = getFirebaseAuth().currentUser;
      if (user) {
        const token = await user.getIdToken();
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        return original(input, { ...init, headers });
      }
    } catch {
      // Fall through to the unmodified request — the cookie may still carry it.
    }
    return original(input, init);
  };
}

export function AuthedFetchProvider(): null {
  // Render-time install (idempotent) so the wrapper is in place before any
  // descendant component fetches on mount.
  installAuthedFetch();
  return null;
}
