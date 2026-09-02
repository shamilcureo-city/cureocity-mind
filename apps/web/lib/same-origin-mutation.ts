import { NextResponse, type NextRequest } from 'next/server';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Browser cookie credentials are ambient, so reject cross-site mutation
 * requests before authentication. Explicit bearer clients are non-ambient and
 * remain supported (including native/server clients without browser headers).
 */
export function enforceSameOriginMutation(req: Request | NextRequest): NextResponse | null {
  if (!MUTATION_METHODS.has(req.method.toUpperCase())) return null;
  if (req.headers.get('authorization')?.startsWith('Bearer ')) return null;
  if (!req.headers.get('cookie')) return null;

  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return denied();

  const origin = req.headers.get('origin');
  // Unsafe cookie-authenticated requests must carry an affirmative browser
  // origin signal. Ambient credentials with neither Origin nor a trustworthy
  // same-origin assertion are indistinguishable from CSRF, so fail closed.
  if (!origin) return denied();
  let expected: string;
  try {
    expected = new URL(req.url).origin;
  } catch {
    return denied();
  }
  if (origin !== expected) return denied();
  return null;
}

function denied(): NextResponse {
  return NextResponse.json(
    { error: 'Cross-site mutation blocked' },
    { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
