'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { createRecaptchaVerifier, getFirebaseAuth } from '@/lib/firebase-therapist';

const RECAPTCHA_ELEMENT_ID = 'recaptcha-anchor';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'phone' | 'otp'>('phone');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\+91\d{10}$/.test(phone)) {
      setError('Enter a 10-digit Indian mobile (+91XXXXXXXXXX)');
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

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!confirmation) return;
    setBusy(true);
    try {
      await confirmation.confirm(otp);
      router.push('/t/clients' as never);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold text-[var(--color-navy-700)]">Cureocity Mind</h1>
        <p className="mt-2 text-sm text-[var(--color-slate-500)]">
          Sign in to your therapist account
        </p>
      </header>

      {stage === 'phone' ? (
        <form onSubmit={sendOtp} className="space-y-4">
          <label className="block text-sm font-medium text-[var(--color-slate-900)]">
            Mobile number
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              required
              className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Sending OTP…' : 'Send OTP'}
          </button>
          <p className="text-center text-xs text-[var(--color-slate-500)]">
            Trouble signing in?{' '}
            <a href="/t/recover" className="underline">
              Recover your account
            </a>
          </p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-4">
          <label className="block text-sm font-medium text-[var(--color-slate-900)]">
            Enter the 6-digit OTP
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              maxLength={6}
              required
              className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm tracking-widest focus:border-[var(--color-navy-500)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div id={RECAPTCHA_ELEMENT_ID} />
    </main>
  );
}
