/**
 * Firebase client SDK initialisation. Browser-only — never imported
 * from a server component. Configured from NEXT_PUBLIC_FIREBASE_*
 * env vars at build time.
 *
 * Phone OTP signup/login is the V1 flow per the plan. Backup email
 * recovery (gap G8) wires in a separate provider once Sharafath
 * confirms the recovery channel.
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
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  };
}

export function getFirebaseAuth(): Auth {
  if (typeof window === 'undefined') {
    throw new Error('getFirebaseAuth called server-side');
  }
  if (auth) return auth;
  const cfg = readClientEnv();
  if (!cfg.apiKey) {
    throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');
  }
  app = getApps()[0] ?? initializeApp(cfg);
  auth = getAuth(app);
  return auth;
}

/**
 * Mounts an invisible reCAPTCHA verifier on a stable element id.
 * Phone OTP flow needs this BEFORE calling signInWithPhoneNumber.
 */
export function createRecaptchaVerifier(elementId: string): RecaptchaVerifier {
  return new RecaptchaVerifier(getFirebaseAuth(), elementId, { size: 'invisible' });
}
