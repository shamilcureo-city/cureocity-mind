import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

/**
 * Lazy Firebase Admin SDK initialiser.
 *
 * Vercel Functions reuse Node processes when they're warm, so we cache
 * the app on `globalThis` to avoid re-initialising on every request.
 *
 * Three env vars expected:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY     (newline-escaped from secret manager)
 *
 * If any are missing the function returns null — the calling guard
 * then falls back to AUTH_BYPASS handling. This keeps local + preview
 * deploys usable without the real Firebase project wired.
 */

declare global {
  var __cureocityFirebaseApp: App | null | undefined;
}

function build(): App | null {
  const projectId = process.env['FIREBASE_PROJECT_ID'];
  const clientEmail = process.env['FIREBASE_CLIENT_EMAIL'];
  const privateKey = process.env['FIREBASE_PRIVATE_KEY']?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;

  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export function firebaseAdmin(): App | null {
  if (globalThis.__cureocityFirebaseApp !== undefined) {
    return globalThis.__cureocityFirebaseApp;
  }
  const app = build();
  globalThis.__cureocityFirebaseApp = app;
  return app;
}

export function firebaseAuth(): Auth | null {
  const app = firebaseAdmin();
  return app ? getAuth(app) : null;
}
