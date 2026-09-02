import { NextResponse, type NextRequest } from 'next/server';
import { enforceSameOriginMutation } from '@/lib/same-origin-mutation';
import type {
  PractitionerCapability,
  PractitionerCredentialKind,
  PractitionerProfession,
} from '@cureocity/contracts';
import { firebaseAuth } from './firebase-admin';
import { prisma } from './prisma';
import { getEffectiveCapabilities, serializeCapabilities } from './capabilities';
import { auditMetadataFromRequest, writeAudit } from './audit';
import {
  regulatedPolicyForRequest,
  resolveRegulatedRequirements,
} from './regulated-route-capabilities';

/**
 * Three resolution functions, ported from the NestJS guards:
 *   resolvePsychologist  — Psychologist row from the request identity.
 *   resolveClient        — Client row from the request identity (paired).
 *   resolveFirebaseUid   — uid only, no row required (used by
 *                          claim-token redeem).
 *
 * Each returns either { ok: true, ... } or a NextResponse with the
 * right HTTP status. The route handler then either uses the resolved
 * value or returns the early response.
 *
 * Identity is accepted from EITHER:
 *   - an `Authorization: Bearer <Firebase id token>` header, or
 *   - the `__session` cookie (Firebase session cookie, minted by
 *     POST /api/v1/auth/session after OTP verify). Server pages and
 *     plain same-origin fetches from client components ride on the
 *     cookie — no Bearer plumbing in components needed.
 *
 * Outside production, bypass (resolves to seeded dev fixtures) engages when
 * AUTH_BYPASS=true or Firebase Admin is unconfigured.
 *
 * On production with Firebase unconfigured, requests FAIL CLOSED with 503
 * instead of silently becoming the demo therapist. AUTH_BYPASS is ignored in
 * production; demo deployments must use a non-production environment.
 */

const DEV_BYPASS_FIREBASE_UID = 'dev-firebase-uid-priya';
const DEV_BYPASS_CLIENT_FIREBASE_UID = 'dev-client-firebase-uid-arjun';

export const SESSION_COOKIE_NAME = '__session';
/// 5 days — matches the Firebase session-cookie max and keeps a
/// weekly-practice therapist signed in between sessions.
export const SESSION_COOKIE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Optional parent-domain scope for the session cookie.
 *
 * UNSET (default) → the cookie is host-only: set by `mind.cureocity.in`,
 * it is sent only back to `mind.cureocity.in`. This is today's behaviour
 * and what localhost / `*.vercel.app` previews need (a domain attr for
 * those hosts would silently drop the cookie).
 *
 * Set to `.cureocity.in` in prod → the cookie is shared across every
 * subdomain, which is what lets the operator console at
 * `admin.cureocity.in` ride the same practitioner login. MUST be applied
 * to every place the cookie is written or cleared (set on sign-in, cleared
 * on sign-out) or a domain-scoped cookie can't be deleted. Returns
 * `undefined` when unset so callers can spread it into cookie options with
 * zero effect.
 */
export function sessionCookieDomain(): string | undefined {
  const d = process.env['SESSION_COOKIE_DOMAIN']?.trim();
  return d && d.length > 0 ? d : undefined;
}

let warnedFailClosed = false;

export function isAuthBypassed(): boolean {
  const production =
    process.env['NODE_ENV'] === 'production' || process.env['VERCEL_ENV'] === 'production';
  if (production) {
    if (firebaseAuth() === null && !warnedFailClosed) {
      warnedFailClosed = true;
      console.error(
        '[auth] Firebase Admin is not configured in production — refusing demo identity.',
      );
    }
    return false;
  }
  if (process.env['AUTH_BYPASS'] === 'true') return true;
  if (firebaseAuth() !== null) return false;
  return true;
}

export interface AuthenticatedUser {
  firebaseUid: string;
  email?: string;
  psychologistId?: string;
  role?: 'THERAPIST' | 'ADMIN';
  /// Sprint DV1 — product vertical of the resolved account. Absent when
  /// no Psychologist row is linked yet. See docs/DOCTOR_VERTICAL.md.
  vertical?: 'THERAPIST' | 'DOCTOR';
  profession?: PractitionerProfession;
  capabilities?: PractitionerCapability[];
  verifiedCredentialKinds?: PractitionerCredentialKind[];
}

export interface AuthenticatedClient {
  firebaseUid: string;
  clientId: string;
}

type Resolved<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

type FirebaseRole = 'PRACTITIONER' | 'CLIENT' | 'NONE' | 'AMBIGUOUS';

async function firebaseRole(uid: string): Promise<FirebaseRole> {
  const [practitioner, client] = await Promise.all([
    prisma.psychologist.findUnique({ where: { firebaseUid: uid }, select: { id: true } }),
    prisma.client.findUnique({ where: { clientFirebaseUid: uid }, select: { id: true } }),
  ]);
  if (practitioner && client) return 'AMBIGUOUS';
  if (practitioner) return 'PRACTITIONER';
  if (client) return 'CLIENT';
  return 'NONE';
}

export async function assertExclusiveFirebaseRole(
  uid: string,
  expected: Exclude<FirebaseRole, 'NONE' | 'AMBIGUOUS'>,
): Promise<Resolved<true>> {
  const role = await firebaseRole(uid);
  if (role === 'AMBIGUOUS' || (role !== 'NONE' && role !== expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Firebase identity has an invalid account role' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, value: true };
}

export async function assertUidAvailableForPractitioner(uid: string): Promise<Resolved<true>> {
  return assertExclusiveFirebaseRole(uid, 'PRACTITIONER');
}

async function auditCapabilityDenials(
  req: NextRequest,
  psychologistId: string,
  capabilities: readonly PractitionerCapability[],
): Promise<void> {
  const results = await Promise.allSettled(
    capabilities.map((capability) =>
      writeAudit({
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psychologistId,
        action: 'CAPABILITY_ACCESS_DENIED',
        targetType: 'PractitionerCapability',
        targetId: capability,
        metadata: auditMetadataFromRequest(req),
      }),
    ),
  );
  if (results.some((result) => result.status === 'rejected')) {
    // Authorization remains fail-closed even when the best-effort denial
    // audit sink is unavailable. Do not include request or patient data here.
    console.error('[auth] Failed to persist one or more capability-denial audit events.');
  }
}

/**
 * Firebase Admin token/cookie verification fetches Google's public
 * signing keys over the network (cached after the first call). On a cold
 * function instance, several concurrent requests — e.g. rapid sidebar
 * navigation firing ~5 RSC requests at once — can race that first fetch,
 * and a transient failure makes verify throw. Callers treat any throw as
 * "invalid session" and redirect to /login, so a brief key-fetch blip
 * logs the user out mid-click. (This is the bug behind "rapid clicks
 * bounce me to the login page" that survived dropping checkRevoked.)
 *
 * This wrapper retries TRANSIENT errors (network / internal) but fails
 * fast on GENUINE auth failures (expired / revoked / malformed) — those
 * must still log the user out. Up to 3 attempts with short backoff; the
 * first successful fetch warms the SDK key cache for the siblings.
 */
const GENUINE_TOKEN_FAILURES = new Set<string>([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/session-cookie-expired',
  'auth/session-cookie-revoked',
  'auth/invalid-session-cookie',
  'auth/argument-error',
]);

export async function verifyWithRetry<T>(verify: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await verify();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code ?? '';
      // Genuine auth failure — do not retry; propagate so the caller
      // logs the user out.
      if (GENUINE_TOKEN_FAILURES.has(code)) throw error;
      // Transient (key fetch / internal error). Back off briefly and
      // retry; the first success populates the SDK key cache for siblings.
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function verifyRequestIdentity(req: NextRequest): Promise<Resolved<string>> {
  // Cookie credentials are ambient. Enforce the browser origin boundary in
  // the shared identity resolver so every practitioner, admin, capability,
  // client, and uid-only cookie path receives the same protection. Explicit
  // bearer clients remain exempt inside enforceSameOriginMutation.
  const crossSite = enforceSameOriginMutation(req);
  if (crossSite) return { ok: false, response: crossSite };
  if (isAuthBypassed()) {
    return { ok: true, value: DEV_BYPASS_FIREBASE_UID };
  }
  const auth = firebaseAuth();
  if (!auth) {
    // Production + unconfigured + no explicit bypass: fail closed.
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication is not configured on this deployment' },
        { status: 503 },
      ),
    };
  }

  const header = req.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = await verifyWithRetry(() =>
        auth.verifyIdToken(header.substring('Bearer '.length)),
      );
      return { ok: true, value: decoded.uid };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? 'unknown';
      console.warn(`[auth-server] verifyIdToken failed code=${code}`);
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
      };
    }
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    try {
      // checkRevoked is intentionally NOT passed (no per-request
      // revocation network call). verifyWithRetry absorbs transient
      // public-key-fetch failures under concurrent requests so a brief
      // blip doesn't 401 a valid session.
      const decoded = await verifyWithRetry(() => auth.verifySessionCookie(cookie));
      return { ok: true, value: decoded.uid };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? 'unknown';
      console.warn(`[auth-server] verifySessionCookie failed code=${code}`);
      return {
        ok: false,
        response: NextResponse.json({ error: 'Session expired — sign in again' }, { status: 401 }),
      };
    }
  }

  return {
    ok: false,
    response: NextResponse.json({ error: 'Missing Bearer token or session' }, { status: 401 }),
  };
}

export async function resolvePsychologist(req: NextRequest): Promise<Resolved<AuthenticatedUser>> {
  const uidRes = await verifyRequestIdentity(req);
  if (!uidRes.ok) return uidRes;
  const exclusive = await assertExclusiveFirebaseRole(uidRes.value, 'PRACTITIONER');
  if (!exclusive.ok) return exclusive;
  const psy = await prisma.psychologist.findUnique({
    where: { firebaseUid: uidRes.value },
    select: { id: true, role: true, vertical: true, deletedAt: true, status: true },
  });
  const user: AuthenticatedUser = { firebaseUid: uidRes.value };
  if (psy && (psy.deletedAt !== null || psy.status !== 'ACTIVE')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Practitioner account is not active' }, { status: 403 }),
    };
  }
  if (psy) {
    user.psychologistId = psy.id;
    user.role = psy.role;
    user.vertical = psy.vertical;
    const effective = await getEffectiveCapabilities(psy.id);
    user.profession = effective.profession ?? undefined;
    user.capabilities = serializeCapabilities(effective);
    user.verifiedCredentialKinds = [...effective.verifiedCredentialKinds].sort();
  }
  return { ok: true, value: user };
}

export async function requirePsychologistId(
  req: NextRequest,
): Promise<Resolved<{ user: AuthenticatedUser; psychologistId: string }>> {
  const resolved = await resolvePsychologist(req);
  if (!resolved.ok) return resolved;
  if (!resolved.value.psychologistId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Firebase user has not registered as a Psychologist yet. Sign in via /login to auto-provision your account.',
        },
        { status: 403 },
      ),
    };
  }

  const routePolicy = regulatedPolicyForRequest(new URL(req.url).pathname, req.method);
  if (routePolicy) {
    const required = resolveRegulatedRequirements(routePolicy, resolved.value.vertical);
    const granted = new Set(resolved.value.capabilities ?? []);
    const authorized =
      routePolicy.mode === 'any'
        ? required.some((capability) => granted.has(capability))
        : required.every((capability) => granted.has(capability));
    if (!authorized) {
      const denied = required.filter((capability) => !granted.has(capability));
      await auditCapabilityDenials(req, resolved.value.psychologistId, denied);
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'This account is not authorized for the requested clinical capability' },
          { status: 403 },
        ),
      };
    }
  }
  return {
    ok: true,
    value: { user: resolved.value, psychologistId: resolved.value.psychologistId },
  };
}

export async function requireCapability(
  req: NextRequest,
  capability: PractitionerCapability,
  preResolved?: Resolved<{ user: AuthenticatedUser; psychologistId: string }>,
): Promise<Resolved<{ user: AuthenticatedUser; psychologistId: string }>> {
  const resolved = preResolved ?? (await requirePsychologistId(req));
  if (!resolved.ok) return resolved;
  // Re-query at the regulated boundary: a capability may have been revoked
  // after the identity snapshot was resolved earlier in the request.
  const effective = await getEffectiveCapabilities(resolved.value.psychologistId);
  if (effective.capabilities.has(capability)) {
    resolved.value.user.profession = effective.profession ?? undefined;
    resolved.value.user.capabilities = serializeCapabilities(effective);
    resolved.value.user.verifiedCredentialKinds = [...effective.verifiedCredentialKinds].sort();
    return resolved;
  }
  await auditCapabilityDenials(req, resolved.value.psychologistId, [capability]);
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'This account is not authorized for the requested clinical capability' },
      { status: 403 },
    ),
  };
}

/**
 * Authorize a mixed read surface when the practitioner may independently
 * access any one of several regulated sections. Callers must still filter
 * the response using the refreshed capability snapshot returned here.
 */
export async function requireAnyCapability(
  req: NextRequest,
  capabilities: readonly PractitionerCapability[],
): Promise<Resolved<{ user: AuthenticatedUser; psychologistId: string }>> {
  const resolved = await requirePsychologistId(req);
  if (!resolved.ok) return resolved;

  const effective = await getEffectiveCapabilities(resolved.value.psychologistId);
  resolved.value.user.profession = effective.profession ?? undefined;
  resolved.value.user.capabilities = serializeCapabilities(effective);
  resolved.value.user.verifiedCredentialKinds = [...effective.verifiedCredentialKinds].sort();
  if (capabilities.some((capability) => effective.capabilities.has(capability))) return resolved;

  await auditCapabilityDenials(req, resolved.value.psychologistId, capabilities);
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'This account is not authorized for the requested clinical capabilities' },
      { status: 403 },
    ),
  };
}

export async function requireAdmin(
  req: NextRequest,
): Promise<Resolved<{ user: AuthenticatedUser; psychologistId: string }>> {
  const resolved = await requirePsychologistId(req);
  if (!resolved.ok) return resolved;
  if (resolved.value.user.role !== 'ADMIN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
    };
  }
  return resolved;
}

export async function resolveClient(req: NextRequest): Promise<Resolved<AuthenticatedClient>> {
  if (isAuthBypassed()) {
    const exclusive = await assertExclusiveFirebaseRole(DEV_BYPASS_CLIENT_FIREBASE_UID, 'CLIENT');
    if (!exclusive.ok) return exclusive;
    const client = await prisma.client.findUnique({
      where: { clientFirebaseUid: DEV_BYPASS_CLIENT_FIREBASE_UID },
      select: { id: true, deletedAt: true, status: true },
    });
    if (!client || client.deletedAt !== null || client.status !== 'ACTIVE') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Bypass client not found or inactive' },
          { status: 401 },
        ),
      };
    }
    return {
      ok: true,
      value: { firebaseUid: DEV_BYPASS_CLIENT_FIREBASE_UID, clientId: client.id },
    };
  }
  const uidRes = await verifyRequestIdentity(req);
  if (!uidRes.ok) return uidRes;
  const exclusive = await assertExclusiveFirebaseRole(uidRes.value, 'CLIENT');
  if (!exclusive.ok) return exclusive;
  const client = await prisma.client.findUnique({
    where: { clientFirebaseUid: uidRes.value },
    select: { id: true, deletedAt: true, status: true },
  });
  if (!client) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No client linked to this Firebase identity' },
        { status: 401 },
      ),
    };
  }
  if (client.deletedAt !== null || client.status !== 'ACTIVE') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Client is not active' }, { status: 401 }),
    };
  }
  return { ok: true, value: { firebaseUid: uidRes.value, clientId: client.id } };
}

/**
 * Used by /claim-tokens/:token/redeem — Firebase uid only, no Client
 * row yet (binding happens inside the route).
 */
export async function resolveFirebaseUidOnly(req: NextRequest): Promise<Resolved<string>> {
  return verifyRequestIdentity(req);
}

export async function resolveFirebaseClaimIdentity(
  req: NextRequest,
): Promise<Resolved<{ firebaseUid: string; phoneNumber: string | null }>> {
  const auth = firebaseAuth();
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication is not configured on this deployment' },
        { status: 503 },
      ),
    };
  }
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 }),
    };
  }
  try {
    const decoded = await verifyWithRetry(() =>
      auth.verifyIdToken(header.substring('Bearer '.length)),
    );
    return {
      ok: true,
      value: { firebaseUid: decoded.uid, phoneNumber: decoded.phone_number ?? null },
    };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
  }
}

/** The seeded therapist identity used when bypass is engaged. */
export function bypassFirebaseUid(): string {
  return DEV_BYPASS_FIREBASE_UID;
}
