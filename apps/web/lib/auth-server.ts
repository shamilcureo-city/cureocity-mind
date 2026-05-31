import { NextResponse, type NextRequest } from 'next/server';
import { firebaseAuth } from './firebase-admin';
import { prisma } from './prisma';

/**
 * Three resolution functions, ported from the NestJS guards:
 *   resolvePsychologist  — Psychologist row from Firebase id token.
 *   resolveClient        — Client row from Firebase id token (paired).
 *   resolveFirebaseUid   — uid only, no row required (used by
 *                          claim-token redeem).
 *
 * Each returns either { ok: true, ... } or a NextResponse with the
 * right HTTP status. The route handler then either uses the resolved
 * value or returns the early response.
 *
 * AUTH_BYPASS=true short-circuits to the seeded dev fixtures so
 * preview deploys without Firebase still work.
 */

const DEV_BYPASS_FIREBASE_UID = 'dev-firebase-uid-priya';
const DEV_BYPASS_CLIENT_FIREBASE_UID = 'dev-client-firebase-uid-arjun';

export interface AuthenticatedUser {
  firebaseUid: string;
  email?: string;
  psychologistId?: string;
  role?: 'THERAPIST' | 'ADMIN';
}

export interface AuthenticatedClient {
  firebaseUid: string;
  clientId: string;
}

type Resolved<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

async function verifyBearer(req: NextRequest): Promise<Resolved<string>> {
  if (process.env['AUTH_BYPASS'] === 'true') {
    return { ok: true, value: DEV_BYPASS_FIREBASE_UID };
  }
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 }),
    };
  }
  const auth = firebaseAuth();
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 401 }),
    };
  }
  try {
    const decoded = await auth.verifyIdToken(header.substring('Bearer '.length));
    return { ok: true, value: decoded.uid };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    };
  }
}

export async function resolvePsychologist(req: NextRequest): Promise<Resolved<AuthenticatedUser>> {
  const uidRes = await verifyBearer(req);
  if (!uidRes.ok) return uidRes;
  const psy = await prisma.psychologist.findUnique({
    where: { firebaseUid: uidRes.value },
    select: { id: true, role: true, deletedAt: true, status: true },
  });
  const user: AuthenticatedUser = { firebaseUid: uidRes.value };
  if (psy && psy.deletedAt === null) {
    user.psychologistId = psy.id;
    user.role = psy.role;
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
            'Firebase user has not registered as a Psychologist yet. POST /api/v1/psychologists first.',
        },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    value: { user: resolved.value, psychologistId: resolved.value.psychologistId },
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
  if (process.env['AUTH_BYPASS'] === 'true') {
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
  const uidRes = await verifyBearer(req);
  if (!uidRes.ok) return uidRes;
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
  return verifyBearer(req);
}
