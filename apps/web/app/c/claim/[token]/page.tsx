'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import type { ClaimTokenPreview } from '@cureocity/contracts';
import { createRecaptchaVerifier, getFirebaseAuth } from '@/lib/firebase-client';
import { fetchClaimPreview, redeemClaim } from '@/lib/api';

const RECAPTCHA_ELEMENT_ID = 'recaptcha-anchor';

type Stage = 'loading' | 'preview' | 'otp' | 'redeeming' | 'done' | 'error';

/**
 * /claim/[token] — the QR landing page.
 *
 * Flow:
 *   1. fetch preview (no auth) → show "Pair as Riya with Dr. Sharma?"
 *   2. user enters phone, OTP arrives via SMS, user enters OTP
 *   3. on confirm, exchange Firebase id token for redeem; route to /
 *
 * If the token has already been redeemed BY THIS phone the redeem call
 * is idempotent and the same result returns — useful when the user
 * scans the QR again later (e.g. after re-installing the PWA).
 */
export default function ClaimPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [preview, setPreview] = useState<ClaimTokenPreview | null>(null);
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const p = await fetchClaimPreview(params.token);
        setPreview(p);
        setStage('preview');
      } catch (e) {
        setError((e as Error).message);
        setStage('error');
      }
    }
    void load();
  }, [params.token]);

  async function sendOtp(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!/^\+91\d{10}$/.test(phone)) {
      setError('Enter a 10-digit Indian mobile number (+91XXXXXXXXXX)');
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
      const idToken = await cred.user.getIdToken();
      setStage('redeeming');
      await redeemClaim(params.token, idToken);
      setStage('done');
      setTimeout(() => router.push('/c'), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStage('preview');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <header className="mb-10 text-center">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Cureocity Mind
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">
          Pair your account
        </h1>
      </header>

      {stage === 'loading' && (
        <p className="text-center text-sm text-[var(--color-slate-500)]">Checking link…</p>
      )}

      {stage === 'error' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? 'This pairing link is invalid or expired. Ask your therapist for a new one.'}
        </div>
      )}

      {preview && (stage === 'preview' || stage === 'otp') && (
        <section className="mb-6 rounded-2xl border border-[var(--color-slate-200)] bg-white p-5">
          <p className="text-sm text-[var(--color-slate-500)]">
            You are about to pair this device as
          </p>
          <p className="mt-1 text-lg font-semibold">{preview.clientFirstName}</p>
          <p className="text-sm text-[var(--color-slate-500)]">
            with <span className="font-medium">{preview.psychologistFullName}</span>
          </p>
          {preview.redeemed && (
            <p className="mt-3 text-xs text-[var(--color-emerald-700)]">
              This link was already paired. Re-verifying will simply confirm the same account.
            </p>
          )}
        </section>
      )}

      {stage === 'preview' && (
        <form onSubmit={sendOtp} className="space-y-4">
          <label className="block text-sm font-medium">
            Your mobile number
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
            className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Sending OTP…' : 'Send OTP'}
          </button>
        </form>
      )}

      {stage === 'otp' && (
        <form onSubmit={verifyOtp} className="space-y-4">
          <label className="block text-sm font-medium">
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
            className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Pair my account'}
          </button>
        </form>
      )}

      {stage === 'redeeming' && (
        <p className="text-center text-sm text-[var(--color-slate-500)]">Linking your account…</p>
      )}

      {stage === 'done' && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-[var(--color-emerald-700)]">
          ✓ Paired. Taking you to your home…
        </div>
      )}

      {error && stage !== 'error' && (
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
