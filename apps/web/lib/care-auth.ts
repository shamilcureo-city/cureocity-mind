import { NextResponse, type NextRequest } from 'next/server';
import { firebaseAuth } from './firebase-admin';
import { isAuthBypassed, SESSION_COOKIE_NAME } from './auth-server';
import { prisma } from './prisma';

/**
 * Cureocity Care — the /care surface's identity resolution (AC1).
 *
 * CareUsers are a SEPARATE audience from practitioners and portal
 * clients: the same Firebase session-cookie transport is reused, but a
 * care request only resolves if the uid maps to a CareUser row — a
 * therapist cookie can never act as a care user (and vice versa: the
 * practitioner guards resolve through the Psychologist table). Every
 * /api/v1/care/* route goes through requireCareUserId and filters every
 * query by the resolved careUserId.
 *
 * Bypass mirrors resolveClient: when Firebase is unconfigured (dev /
 * preview) or AUTH_BYPASS=true, requests resolve to the seeded demo
 * care user — auto-created here so `pnpm dev` works with zero setup.
 */

export const DEV_BYPASS_CARE_FIREBASE_UID = 'dev-care-firebase-uid-kavya';

export interface AuthenticatedCareUser {
  firebaseUid: string;
  careUserId: string;
  careUser: {
    id: string;
    displayName: string;
    status: 'ACTIVE' | 'SAFETY_HOLD' | 'DELETED';
    safetyHoldAt: Date | null;
    planTier: string;
    onboardedAt: Date | null;
    personaName: string;
    voiceName: string;
    personaStyle: string;
    vadSilenceMs: number;
    preferredLanguage: string;
    spokenLanguages: string[];
    trustedContactName: string | null;
    trustedContactPhone: string | null;
  };
}

type Resolved<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

const CARE_USER_SELECT = {
  id: true,
  displayName: true,
  status: true,
  safetyHoldAt: true,
  planTier: true,
  onboardedAt: true,
  personaName: true,
  voiceName: true,
  personaStyle: true,
  vadSilenceMs: true,
  preferredLanguage: true,
  spokenLanguages: true,
  trustedContactName: true,
  trustedContactPhone: true,
} as const;

async function verifyCareIdentity(req: NextRequest): Promise<Resolved<string>> {
  if (isAuthBypassed()) {
    return { ok: true, value: DEV_BYPASS_CARE_FIREBASE_UID };
  }
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
  if (header?.startsWith('Bearer ')) {
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
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    try {
      const decoded = await auth.verifySessionCookie(cookie, true);
      return { ok: true, value: decoded.uid };
    } catch {
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

export async function resolveCareUser(req: NextRequest): Promise<Resolved<AuthenticatedCareUser>> {
  const uidRes = await verifyCareIdentity(req);
  if (!uidRes.ok) return uidRes;

  let careUser = await prisma.careUser.findUnique({
    where: { firebaseUid: uidRes.value },
    select: CARE_USER_SELECT,
  });

  // Dev convenience only: in bypass mode the demo care user materialises
  // on first touch so the /care flow runs with zero seeding.
  if (!careUser && isAuthBypassed() && uidRes.value === DEV_BYPASS_CARE_FIREBASE_UID) {
    careUser = await prisma.careUser.create({
      data: {
        firebaseUid: DEV_BYPASS_CARE_FIREBASE_UID,
        displayName: 'Kavya',
        preferredLanguage: 'en',
        spokenLanguages: ['ml', 'en'],
      },
      select: CARE_USER_SELECT,
    });
  }

  if (!careUser) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No care account linked to this identity. Sign up at /care/login.' },
        { status: 401 },
      ),
    };
  }
  if (careUser.status === 'DELETED') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'This account has been deleted' }, { status: 401 }),
    };
  }
  return {
    ok: true,
    value: { firebaseUid: uidRes.value, careUserId: careUser.id, careUser },
  };
}

export async function requireCareUserId(
  req: NextRequest,
): Promise<Resolved<AuthenticatedCareUser>> {
  return resolveCareUser(req);
}

/** Firebase uid only — used by the care auth/session mint route. */
export async function resolveCareFirebaseUid(req: NextRequest): Promise<Resolved<string>> {
  return verifyCareIdentity(req);
}
