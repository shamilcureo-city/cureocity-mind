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

export function isFirebaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
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

/**
 * Sprint 36 — map Firebase auth error codes to human messages.
 *
 * The setup-time codes (configuration-not-found / operation-not-allowed
 * / captcha-check-failed) only surface while the project is being wired,
 * so their messages carry a short admin hint. The runtime codes
 * (invalid number / wrong code / rate limit) read as plain user guidance.
 * Unknown codes fall back to the raw Firebase message with the noisy
 * "Firebase: …" prefix stripped.
 */
export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/configuration-not-found':
      return 'Phone sign-in isn’t enabled for this app yet. (Admin: enable Phone under Firebase → Authentication → Sign-in method.)';
    case 'auth/operation-not-allowed':
      return 'SMS to this region isn’t enabled yet. (Admin: allow it under Firebase → Authentication → Settings → SMS region policy.)';
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
    case 'auth/unauthorized-domain':
      return 'This site isn’t authorised for sign-in yet. (Admin: add this domain under Firebase → Authentication → Settings → Authorized domains.)';
    case 'auth/invalid-phone-number':
      return 'That doesn’t look like a valid number. Use international format, like +91XXXXXXXXXX.';
    case 'auth/missing-phone-number':
      return 'Enter your mobile number first.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/quota-exceeded':
      return 'The SMS limit was reached for now. Please try again later.';
    case 'auth/invalid-verification-code':
      return 'That code didn’t match. Check the 6 digits and try again.';
    case 'auth/code-expired':
      return 'That code expired. Request a new one.';
    case 'auth/network-request-failed':
      return 'Network problem reaching sign-in. Check your connection and retry.';
    default: {
      const msg = (err as Error | null)?.message ?? 'Something went wrong. Please try again.';
      return msg.replace(/^Firebase:\s*/i, '').trim();
    }
  }
}
