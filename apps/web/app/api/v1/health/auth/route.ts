import { NextResponse, type NextRequest } from 'next/server';
import { isAuthBypassed, requirePsychologistId } from '@/lib/auth-server';
import { firebaseAdmin } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health/auth — diagnostic snapshot of the auth posture.
 *
 * Answers the question "why does every Google sign-in land on the same
 * account?" in one call: is the server in BYPASS (resolving every
 * request to the seeded demo therapist) or is real per-user Firebase
 * auth active? Reports env-var PRESENCE only — never values, never
 * secrets.
 *
 * Same `requirePsychologistId` gate as /health/llm: under bypass this
 * resolves to the fixture (so you can always reach it while debugging);
 * once real auth is on, hit it signed in as yourself.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const bypassActive = isAuthBypassed();
  const adminConfigured = firebaseAdmin() !== null;
  const config = {
    bypassActive,
    AUTH_BYPASS: process.env['AUTH_BYPASS'] ?? '(unset)',
    VERCEL_ENV: process.env['VERCEL_ENV'] ?? '(unset)',
    firebaseAdminConfigured: adminConfigured,
    FIREBASE_PROJECT_ID_present: Boolean(process.env['FIREBASE_PROJECT_ID']),
    FIREBASE_CLIENT_EMAIL_present: Boolean(process.env['FIREBASE_CLIENT_EMAIL']),
    FIREBASE_PRIVATE_KEY_present: Boolean(process.env['FIREBASE_PRIVATE_KEY']),
    // The browser-side config that powers the Google/phone/email popups.
    NEXT_PUBLIC_FIREBASE_API_KEY_present: Boolean(process.env['NEXT_PUBLIC_FIREBASE_API_KEY']),
  };

  const diagnostics: string[] = [];
  if (bypassActive) {
    if (process.env['AUTH_BYPASS'] === 'true') {
      diagnostics.push(
        'BYPASS is ON because AUTH_BYPASS=true — every sign-in (Google, email, phone) ' +
          'resolves to the shared demo therapist. Remove AUTH_BYPASS to enable per-user accounts.',
      );
    } else {
      diagnostics.push(
        'BYPASS is ON because Firebase Admin is not configured on a non-production deploy — ' +
          'every sign-in resolves to the shared demo therapist.',
      );
    }
    if (!adminConfigured) {
      diagnostics.push(
        'Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (server-side, ' +
          'same service-account JSON as NEXT_PUBLIC_FIREBASE_*) so the server can verify tokens.',
      );
    }
  } else if (!adminConfigured) {
    diagnostics.push(
      'Bypass is OFF but Firebase Admin is NOT configured — auth will FAIL CLOSED (503). ' +
        'Set FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY, or set AUTH_BYPASS=true for a demo deploy.',
    );
  } else {
    diagnostics.push('Real per-user Firebase auth is active. Each account maps to its own therapist.');
  }

  return NextResponse.json({ config, diagnostics });
}
