'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  signInWithPhoneNumber,
  type ConfirmationResult,
  type RecaptchaVerifier,
  type User,
} from 'firebase/auth';
import { createRecaptchaVerifier, getFirebaseAuth } from '@/lib/firebase-client';

const INTERNATIONAL_PHONE = /^\+[1-9]\d{7,14}$/;

export function isValidInternationalPhoneNumber(phone: string): boolean {
  return INTERNATIONAL_PHONE.test(phone);
}

type ClientPhoneSignInProps = {
  onSignedIn?: (user: User) => void | Promise<void>;
  verificationButtonLabel?: string;
  verificationErrorMessage?: string;
};

export default function ClientPhoneSignIn({
  onSignedIn,
  verificationButtonLabel = 'Sign in to my care page',
  verificationErrorMessage = 'Could not verify the code. Please try again.',
}: ClientPhoneSignInProps) {
  const recaptchaId = useId();
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearVerifier() {
    verifier.current?.clear();
    verifier.current = null;
  }

  useEffect(() => clearVerifier, []);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    const normalizedPhone = phone.trim();
    if (!isValidInternationalPhoneNumber(normalizedPhone)) {
      setError('Enter a valid mobile number with country code, for example +919876543210.');
      return;
    }

    setBusy(true);
    setError(null);
    clearVerifier();
    try {
      verifier.current = createRecaptchaVerifier(recaptchaId);
      const result = await signInWithPhoneNumber(
        getFirebaseAuth(),
        normalizedPhone,
        verifier.current,
      );
      clearVerifier();
      setConfirmation(result);
    } catch {
      clearVerifier();
      setError('Could not send the verification code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmOtp(event: FormEvent) {
    event.preventDefault();
    if (!confirmation || !/^\d{6}$/.test(otp)) return;

    setBusy(true);
    setError(null);
    try {
      const credential = await confirmation.confirm(otp);
      await onSignedIn?.(credential.user);
    } catch {
      setError(verificationErrorMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6" aria-labelledby="client-phone-sign-in-heading">
      <h2 id="client-phone-sign-in-heading" className="font-serif text-xl">
        Sign in by phone
      </h2>
      {!confirmation ? (
        <form onSubmit={requestOtp} className="mt-3 space-y-3">
          <label htmlFor="client-phone-number" className="block text-sm">
            Mobile number with country code
          </label>
          <input
            id="client-phone-number"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-describedby="client-phone-hint"
            disabled={busy}
            className="w-full rounded-xl border p-3"
          />
          <p id="client-phone-hint" className="text-xs text-[var(--color-ink-3)]">
            Include + and your country code. Standard SMS rates may apply.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-[var(--color-accent)] px-4 py-3 text-white disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send verification code'}
          </button>
        </form>
      ) : (
        <form onSubmit={confirmOtp} className="mt-3 space-y-3">
          <label htmlFor="client-phone-code" className="block text-sm">
            Six-digit code
          </label>
          <input
            id="client-phone-code"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={busy}
            className="w-full rounded-xl border p-3"
          />
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            className="w-full rounded-full bg-[var(--color-accent)] px-4 py-3 text-white disabled:opacity-60"
          >
            {busy ? 'Verifying…' : verificationButtonLabel}
          </button>
        </form>
      )}
      {busy && (
        <p className="sr-only" role="status">
          Please wait.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      <div id={recaptchaId} />
    </section>
  );
}
