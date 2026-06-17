'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import {
  createEmailAccount,
  createRecaptchaVerifier,
  friendlyAuthError,
  getFirebaseAuth,
  isFirebaseConfigured,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
} from '@/lib/firebase-therapist';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { Label, Input, FieldError } from '@/components/ui/Field';

const RECAPTCHA_ELEMENT_ID = 'recaptcha-anchor';

type Method = 'google' | 'email' | 'phone';
type EmailMode = 'signin' | 'signup' | 'reset';
type Stage = 'pick' | 'otp' | 'invite' | 'reset-sent';

/**
 * Sprint 56 — login redesign.
 *
 * Three sign-in methods, all minting the same session cookie via
 * /api/v1/auth/session. Google is the primary CTA (one click, no
 * friction); email is the reliable fallback; phone OTP is preserved
 * but moved off the default surface so SMS-region issues don't block
 * sign-up.
 *
 * Auto-redirect to /app if Firebase isn't configured (auth bypass on
 * staging deploys without Firebase env). Carries an optional ?next=
 * for post-login redirect.
 *
 * Next 15 — useSearchParams() bails out of static rendering, so the
 * client body lives in an inner component wrapped in <Suspense>.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/app';

  const [method, setMethod] = useState<Method>('google');
  const [stage, setStage] = useState<Stage>('pick');
  const [emailMode, setEmailMode] = useState<EmailMode>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
  }, [method, emailMode]);

  // POST the verified id token for a session cookie. Returns 'invite'
  // when the pilot gate (Sprint 37) needs a code, 'ok' on success.
  async function startSession(idToken: string, code?: string): Promise<'ok' | 'invite'> {
    const res = await fetch('/api/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, ...(code ? { inviteCode: code } : {}) }),
    });
    if (res.ok) return 'ok';
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (res.status === 403 && body?.code === 'INVITE_REQUIRED') {
      setError(body.error ?? 'An invite code is required for this pilot.');
      return 'invite';
    }
    throw new Error(body?.error ?? 'Could not start your session. Please try again.');
  }

  async function handleGoogle() {
    setError(null);
    if (!isFirebaseConfigured()) {
      router.push(next);
      return;
    }
    setBusy(true);
    try {
      const cred = await signInWithGoogle();
      // null = redirect path; the page reloads + the route guard takes over.
      if (!cred) return;
      const idToken = await cred.user.getIdToken();
      const result = await startSession(idToken);
      if (result === 'invite') setStage('invite');
      else router.push(next);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isFirebaseConfigured()) {
      router.push(next);
      return;
    }
    setBusy(true);
    try {
      if (emailMode === 'reset') {
        await resetPassword(email.trim());
        setStage('reset-sent');
        return;
      }
      const cred =
        emailMode === 'signup'
          ? await createEmailAccount(email.trim(), password)
          : await signInWithEmail(email.trim(), password);
      const idToken = await cred.user.getIdToken();
      const result = await startSession(idToken);
      if (result === 'invite') setStage('invite');
      else router.push(next);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isFirebaseConfigured()) {
      router.push(next);
      return;
    }
    if (!/^\+\d{8,15}$/.test(phone)) {
      setError('Enter your number in international format, like +91XXXXXXXXXX.');
      return;
    }
    setBusy(true);
    try {
      const verifier = createRecaptchaVerifier(RECAPTCHA_ELEMENT_ID);
      const conf = await signInWithPhoneNumber(getFirebaseAuth(), phone, verifier);
      setConfirmation(conf);
      setStage('otp');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!confirmation) return;
    setBusy(true);
    try {
      const cred = await confirmation.confirm(otp);
      const idToken = await cred.user.getIdToken();
      const result = await startSession(idToken, inviteCode.trim() || undefined);
      if (result === 'invite') setStage('invite');
      else router.push(next);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setStage('pick');
      setError('Your sign-in expired — please start again.');
      return;
    }
    setBusy(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await startSession(idToken, inviteCode.trim());
      if (result === 'ok') router.push(next);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setStage('pick');
    setOtp('');
    setPassword('');
    setInviteCode('');
    setConfirmation(null);
    setError(null);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Decorative background — subtle radial gradient, no images */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'radial-gradient(900px 600px at 8% 0%, rgba(74,123,103,0.18), transparent 60%), radial-gradient(800px 600px at 92% 90%, rgba(232,217,193,0.45), transparent 60%)',
        }}
      />

      <Container className="grid min-h-screen items-center py-12">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          {/* Left rail — brand + value props */}
          <section className="hidden lg:block">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent)] font-serif text-base text-white shadow-sm"
              >
                cm
              </span>
              <span className="font-serif text-lg tracking-tight">Cureocity Mind</span>
            </Link>
            <h1 className="mt-10 font-serif text-5xl leading-[1.1] tracking-tight text-[var(--color-ink)]">
              Get your evenings back.
            </h1>
            <p className="mt-4 max-w-md text-base text-[var(--color-ink-2)]">
              The clinical co-pilot that writes your notes and tracks your clients’ progress while
              you focus on the work.
            </p>
            <ul className="mt-10 space-y-4 text-sm text-[var(--color-ink-2)]">
              {[
                {
                  title: 'AI scribe in your sessions',
                  body: 'SOAP + intake notes auto-drafted from the recording. You modify, accept, sign.',
                },
                {
                  title: 'Built for Indian practice',
                  body: 'Manglish, Hinglish, Tanglish — code-mix-first transcription that other tools choke on.',
                },
                {
                  title: 'Encrypted + audited end-to-end',
                  body: 'In-region AI for DPDP. Cryptographic sign-off on every note. Audit log on every action.',
                },
              ].map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3 w-3"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                  <span>
                    <strong className="font-medium text-[var(--color-ink)]">{item.title}.</strong>{' '}
                    {item.body}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-12 text-xs text-[var(--color-ink-3)]">
              Trusted by therapists across Bangalore, Mumbai, Kochi, and Delhi.
            </p>
          </section>

          {/* Right rail — sign-in card */}
          <aside className="w-full rounded-3xl border border-[var(--color-line)] bg-white/95 p-7 shadow-[0_30px_80px_-40px_rgba(15,27,42,0.25)] backdrop-blur sm:p-9">
            {/* Mobile brand head */}
            <div className="mb-6 flex items-center gap-2 lg:hidden">
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] font-serif text-base text-white"
              >
                cm
              </span>
              <span className="font-serif text-base tracking-tight">Cureocity Mind</span>
            </div>

            {stage === 'pick' && (
              <>
                <h2 className="font-serif text-2xl text-[var(--color-ink)]">
                  Sign in to your practice
                </h2>
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                  New here? Continue with Google or create an email account — we’ll set you up.
                </p>

                {/* Google primary */}
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={busy}
                  className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-full border border-[var(--color-line)] bg-white px-5 py-3 text-sm font-medium text-[var(--color-ink)] shadow-sm transition hover:bg-[var(--color-surface)] disabled:opacity-60"
                >
                  <GoogleGlyph />
                  {busy && method === 'google' ? 'Opening Google…' : 'Continue with Google'}
                </button>

                {/* Method tabs — Email | Phone */}
                <div className="mt-6 flex items-center gap-3 text-xs text-[var(--color-ink-3)]">
                  <span className="h-px flex-1 bg-[var(--color-line-soft)]" />
                  or
                  <span className="h-px flex-1 bg-[var(--color-line-soft)]" />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-1 rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-1 text-xs">
                  {(['email', 'phone'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`rounded-full px-3 py-2 font-medium transition ${
                        method === m
                          ? 'bg-white text-[var(--color-ink)] shadow-sm'
                          : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
                      }`}
                    >
                      {m === 'email' ? 'Email + password' : 'Phone OTP'}
                    </button>
                  ))}
                </div>

                {method === 'email' && (
                  <form onSubmit={handleEmail} className="mt-5 space-y-4">
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourpractice.com"
                        required
                      />
                    </div>
                    {emailMode !== 'reset' && (
                      <div>
                        <Label
                          htmlFor="password"
                          hint={emailMode === 'signup' ? 'Minimum 6 characters' : undefined}
                        >
                          Password
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          autoComplete={
                            emailMode === 'signup' ? 'new-password' : 'current-password'
                          }
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          minLength={6}
                          required
                        />
                      </div>
                    )}
                    <Button type="submit" size="lg" disabled={busy} className="w-full">
                      {busy
                        ? emailMode === 'reset'
                          ? 'Sending…'
                          : 'Signing in…'
                        : emailMode === 'signup'
                          ? 'Create account'
                          : emailMode === 'reset'
                            ? 'Send reset email'
                            : 'Sign in'}
                    </Button>
                    <FieldError message={error} />
                    <div className="flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setEmailMode(emailMode === 'signup' ? 'signin' : 'signup')
                        }
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        {emailMode === 'signup'
                          ? 'Have an account? Sign in'
                          : 'New here? Create an account'}
                      </button>
                      {emailMode !== 'reset' ? (
                        <button
                          type="button"
                          onClick={() => setEmailMode('reset')}
                          className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                        >
                          Forgot password?
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEmailMode('signin')}
                          className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                        >
                          Back to sign in
                        </button>
                      )}
                    </div>
                  </form>
                )}

                {method === 'phone' && (
                  <form onSubmit={sendOtp} className="mt-5 space-y-4">
                    <div>
                      <Label htmlFor="phone" hint="International format">
                        Mobile number
                      </Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        autoComplete="tel"
                        placeholder="+91XXXXXXXXXX"
                        required
                      />
                    </div>
                    <Button type="submit" size="lg" disabled={busy} className="w-full">
                      {busy ? 'Sending OTP…' : 'Send OTP'}
                    </Button>
                    <FieldError message={error} />
                    <p className="text-xs text-[var(--color-ink-3)]">
                      Having trouble with the OTP? Use Google or Email above — they always work.
                    </p>
                  </form>
                )}

                {!isFirebaseConfigured() && (
                  <p className="mt-5 rounded-xl bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">
                    Demo mode — Firebase isn’t configured. Any sign-in lands on the seeded demo
                    therapist.
                  </p>
                )}
              </>
            )}

            {stage === 'otp' && (
              <form onSubmit={verifyOtp} className="space-y-5">
                <div>
                  <h2 className="font-serif text-2xl">Enter the 6-digit code</h2>
                  <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                    Sent to <span className="font-medium text-[var(--color-ink)]">{phone}</span>.
                  </p>
                </div>
                <div>
                  <Label htmlFor="otp">OTP</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    maxLength={6}
                    className="tracking-[0.6em] text-center text-lg"
                    required
                  />
                </div>
                <Button type="submit" size="lg" disabled={busy || otp.length < 6} className="w-full">
                  {busy ? 'Verifying…' : 'Verify and continue'}
                </Button>
                <FieldError message={error} />
                <button
                  type="button"
                  onClick={startOver}
                  className="block w-full text-center text-xs text-[var(--color-ink-3)] underline"
                >
                  Use a different method
                </button>
              </form>
            )}

            {stage === 'invite' && (
              <form onSubmit={submitInvite} className="space-y-5">
                <div>
                  <h2 className="font-serif text-2xl">You’re almost in</h2>
                  <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                    Cureocity Mind is in invite-only pilot. Enter the code you were given.
                  </p>
                </div>
                <div>
                  <Label htmlFor="invite">Invite code</Label>
                  <Input
                    id="invite"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="CURE-XXXX-XXXX"
                    autoCapitalize="characters"
                    className="uppercase tracking-[0.2em]"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  disabled={busy || inviteCode.trim().length === 0}
                  className="w-full"
                >
                  {busy ? 'Checking…' : 'Join the pilot'}
                </Button>
                <FieldError message={error} />
                <button
                  type="button"
                  onClick={startOver}
                  className="block w-full text-center text-xs text-[var(--color-ink-3)] underline"
                >
                  Start over
                </button>
              </form>
            )}

            {stage === 'reset-sent' && (
              <div className="space-y-5 text-center">
                <h2 className="font-serif text-2xl">Check your email</h2>
                <p className="text-sm text-[var(--color-ink-2)]">
                  We sent a password-reset link to{' '}
                  <span className="font-medium text-[var(--color-ink)]">{email}</span>. Tap the
                  link, set a new password, then come back here to sign in.
                </p>
                <Button onClick={startOver} size="lg" className="w-full">
                  Back to sign in
                </Button>
              </div>
            )}

            <p className="mt-6 text-center text-[11px] text-[var(--color-ink-3)]">
              By continuing you agree to our terms and privacy policy. We never share your data.
            </p>

            <div id={RECAPTCHA_ELEMENT_ID} />
          </aside>
        </div>
      </Container>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.45c-.28 1.5-1.13 2.78-2.41 3.63v3.01h3.89c2.28-2.1 3.56-5.19 3.56-8.88z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.89-3.01c-1.08.72-2.45 1.16-4.04 1.16-3.11 0-5.74-2.1-6.68-4.92H1.3v3.09C3.27 21.3 7.3 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.32 14.32c-.24-.72-.38-1.49-.38-2.32s.14-1.6.38-2.32V6.59H1.3A11.99 11.99 0 000 12c0 1.94.47 3.78 1.3 5.41l4.02-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.79l3.43-3.43C17.95 1.19 15.24 0 12 0 7.3 0 3.27 2.7 1.3 6.59l4.02 3.09C6.26 6.85 8.89 4.75 12 4.75z"
      />
    </svg>
  );
}
