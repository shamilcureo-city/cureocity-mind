/**
 * Firebase client SDK initialisation for the patient PWA.
 *
 * Distinct Firebase project credentials from therapist-web — the
 * patient and therapist identities are completely separated so a
 * single Firebase UID never spans both audiences. Configured from
 * NEXT_PUBLIC_FIREBASE_CLIENT_* env vars at build time.
 */
import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
import { getAuth, type Auth, RecaptchaVerifier } from 'firebase/auth';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function readClientEnv(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
} {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_CLIENT_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_CLIENT_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_CLIENT_PROJECT_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_CLIENT_APP_ID ?? '',
  };
}

export function isFirebaseClientConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_CLIENT_API_KEY);
}

export function getFirebaseAuth(): Auth {
  if (typeof window === 'undefined') {
    throw new Error('getFirebaseAuth called server-side');
  }
  if (auth) return auth;
  const cfg = readClientEnv();
  if (!cfg.apiKey) {
    throw new Error('NEXT_PUBLIC_FIREBASE_CLIENT_API_KEY is not set');
  }
  app = getApps()[0] ?? initializeApp(cfg);
  auth = getAuth(app);
  return auth;
}

export function createRecaptchaVerifier(elementId: string): RecaptchaVerifier {
  return new RecaptchaVerifier(getFirebaseAuth(), elementId, { size: 'invisible' });
}
