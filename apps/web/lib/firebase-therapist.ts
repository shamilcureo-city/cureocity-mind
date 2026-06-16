/**
 * Firebase client SDK initialisation. Browser-only — never imported
 * from a server component. Configured from NEXT_PUBLIC_FIREBASE_*
 * env vars at build time.
 *
 * Three sign-in methods, all funnel through the same /api/v1/auth/session
 * route which accepts any Firebase idToken (phone, email, Google):
 *   1. Google one-click  (signInWithGoogle) — recommended, zero friction
 *   2. Email + password  (signInWithEmail, createEmailAccount, resetPassword)
 *   3. Phone OTP         (createRecaptchaVerifier + signInWithPhoneNumber)
 */
import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
  type UserCredential,
} from 'firebase/auth';

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
 * Google one-click sign-in. Uses popup by default; falls back to
 * redirect on browsers (in-app webviews, some mobile Safari) that
 * block popups. The session cookie minted server-side works either way.
 */
export async function signInWithGoogle(): Promise<UserCredential | null> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(getFirebaseAuth(), provider);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
      // Redirect doesn't return a UserCredential synchronously; the page
      // reloads and the caller picks the user up via onAuthStateChanged
      // (or just gets redirected by the route guard).
      await signInWithRedirect(getFirebaseAuth(), provider);
      return null;
    }
    throw err;
  }
}

/** Email + password — existing account. */
export async function signInWithEmail(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

/** Email + password — create a new account (auto-provisions the Psychologist row). */
export async function createEmailAccount(email: string, password: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
}

/** Send a password-reset email. */
export async function resetPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(getFirebaseAuth(), email);
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
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Allow popups for this site and retry.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was closed before finishing.';
    case 'auth/account-exists-with-different-credential':
      return 'An account with this email exists with a different sign-in method. Try Google or Phone, or reset your password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Email or password is incorrect. Try again or reset your password.';
    case 'auth/user-not-found':
      return 'No account with that email — switch to "Create account" to sign up.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists — switch to "Sign in" or reset your password.';
    case 'auth/invalid-email':
      return 'That doesn’t look like a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/missing-password':
      return 'Enter a password.';
    default: {
      const msg = (err as Error | null)?.message ?? 'Something went wrong. Please try again.';
      return msg.replace(/^Firebase:\s*/i, '').trim();
    }
  }
}
