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
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
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
    if (!/^\+91\d{10}$/.test(phone)) {
      setError('Enter a 10-digit Indian mobile (+91XXXXXXXXXX).');
      return;
    }
    if (!isFirebaseConfigured()) {
      router.push('/dashboard');
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
      await confirmation.confirm(otp);
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="pb-24">
        <Container className="pt-16">
          <div className="mx-auto grid max-w-5xl items-center gap-16 lg:grid-cols-[1.1fr_1fr]">
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                Therapist log in
              </p>
              <h1 className="mt-3 font-serif text-5xl leading-tight">Welcome back.</h1>
              <p className="mt-3 text-[var(--color-ink-2)]">
                Sign in to see today’s sessions, your matched intakes, and your client roster. We
                use phone OTP — no passwords.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-[var(--color-ink-2)]">
                {[
                  'Encrypted notes and audit logs by default',
                  'Matched intakes delivered each morning',
                  'Light-touch tools, designed by clinicians',
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
              <p className="mt-10 text-sm text-[var(--color-ink-3)]">
                New to the practice?{' '}
                <Link href="/for-therapists" className="text-[var(--color-accent)] underline">
                  Apply to join
                </Link>
                .
              </p>
            </section>

            <aside className="rounded-3xl border border-[var(--color-line)] bg-white p-8 shadow-[0_24px_60px_-32px_rgba(15,27,42,0.18)]">
              {stage === 'phone' ? (
                <form onSubmit={sendOtp} className="space-y-5">
                  <div>
                    <Label htmlFor="phone">Mobile number</Label>
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
                  <p className="text-center text-xs text-[var(--color-ink-3)]">
                    Trouble signing in?{' '}
                    <Link href="/for-therapists" className="underline">
                      Reach our support
                    </Link>
                  </p>
                </form>
              ) : (
                <form onSubmit={verifyOtp} className="space-y-5">
                  <p className="text-sm text-[var(--color-ink-2)]">
                    Sent a 6-digit code to{' '}
                    <span className="font-medium text-[var(--color-ink)]">{phone}</span>.
                  </p>
                  <div>
                    <Label htmlFor="otp">OTP</Label>
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
      <Footer />
    </>
  );
}
