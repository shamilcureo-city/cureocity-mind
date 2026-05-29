/**
 * Server-side API client for React Server Components.
 *
 * Talks to patient-model-service and friends. Forwards the therapist's
 * Firebase ID token via the Authorization header — for V1 we pass a
 * dev-bypass token (matching AUTH_BYPASS=true on the backend) so the
 * scaffold renders without a real OTP loop. Sprint 7 swaps this for
 * the real session-cookie → token exchange.
 */

const PATIENT_MODEL_BASE = process.env.PATIENT_MODEL_SERVICE_BASE ?? 'http://localhost:3001/api/v1';

interface FetchOptions {
  /** Bearer token; omit to use the dev bypass. */
  token?: string;
  next?: { revalidate?: number; tags?: string[] };
  /** Throw on non-2xx (default true). */
  throwOnError?: boolean;
}

export async function fetchPatientModel<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const url = `${PATIENT_MODEL_BASE}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  } else {
    // Dev-bypass: backend reads AUTH_BYPASS=true and injects the seed user
    // regardless of the token. Sprint 7 will require a real token.
    headers.Authorization = 'Bearer dev-bypass';
  }
  const res = await fetch(url, { headers, next: opts.next });
  if (!res.ok && opts.throwOnError !== false) {
    throw new Error(`${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
