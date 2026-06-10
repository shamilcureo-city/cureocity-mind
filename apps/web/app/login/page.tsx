'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import {
  createRecaptchaVerifier,
  getFirebaseAuth,
  isFirebaseConfigured,
} from '@/lib/firebase-therapist';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { Label, Input, FieldError } from '@/components/ui/Field';

const RECAPTCHA_ELEMENT_ID = 'recaptcha-anchor';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'phone' | 'otp'>('phone');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendOtp(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!isFirebaseConfigured()) {
      router.push('/app');
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
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!confirmation) return;
    setBusy(true);
    try {
      const cred = await confirmation.confirm(otp);
      // Exchange the id token for an httpOnly session cookie. First
      // sign-in auto-provisions the Psychologist row (the signup).
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not start your session. Please try again.');
      }
      router.push('/app');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center">
      <Container className="py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-16 lg:grid-cols-[1.1fr_1fr]">
          <section>
            <Link href="/" className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] font-serif text-base text-white"
              >
                cm
              </span>
              <span className="font-serif text-lg tracking-tight">Cureocity Mind</span>
            </Link>
            <h1 className="mt-10 font-serif text-5xl leading-tight">Sign in to your practice.</h1>
            <p className="mt-3 max-w-md text-[var(--color-ink-2)]">
              Phone-OTP login — no passwords. The scribe, your clients, and your notes are one tap
              away.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-[var(--color-ink-2)]">
              {[
                'Encrypted at rest. Audit log on every action.',
                'In-region AI processing for your clinic.',
                'Cryptographic sign-off on every note.',
              ].map((it) => (
                <li key={it} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                  />
                  {it}
                </li>
              ))}
            </ul>
          </section>

          <aside className="rounded-3xl border border-[var(--color-line)] bg-white p-8 shadow-[0_24px_60px_-32px_rgba(15,27,42,0.18)]">
            {stage === 'phone' ? (
              <form onSubmit={sendOtp} className="space-y-5">
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
                {!isFirebaseConfigured() && (
                  <p className="rounded-xl bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">
                    Demo mode — Firebase isn't configured. Tapping continue signs you in as the
                    seeded demo therapist.
                  </p>
                )}
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-5">
                <p className="text-sm text-[var(--color-ink-2)]">
                  Code sent to <span className="font-medium text-[var(--color-ink)]">{phone}</span>.
                </p>
                <div>
                  <Label htmlFor="otp">6-digit OTP</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    maxLength={6}
                    className="tracking-[0.6em] text-center text-lg"
                    required
                  />
                </div>
                <Button type="submit" size="lg" disabled={busy} className="w-full">
                  {busy ? 'Verifying…' : 'Verify and continue'}
                </Button>
                <FieldError message={error} />
                <button
                  type="button"
                  onClick={() => {
                    setStage('phone');
                    setOtp('');
                  }}
                  className="block w-full text-center text-xs text-[var(--color-ink-3)] underline"
                >
                  Use a different number
                </button>
              </form>
            )}
            <div id={RECAPTCHA_ELEMENT_ID} />
          </aside>
        </div>
      </Container>
    </main>
  );
}
