'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getFirebaseAuth, isFirebaseClientConfigured } from '@/lib/firebase-client';

/**
 * /care/login (AC1, S2) — phone-OTP-first, signup and sign-in unified.
 * On confirm, the id token is exchanged for the care-audience session
 * cookie at POST /api/v1/care/auth/session (NOT the practitioner mint).
 * When Firebase client env is absent (dev bypass), a demo button walks
 * straight in — the server guards resolve the seeded demo care user.
 */
export function CareLogin() {
  const router = useRouter();
  const configured = isFirebaseClientConfigured();
  const [phone, setPhone] = useState('+91 ');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const auth = getFirebaseAuth();
      const verifier = new RecaptchaVerifier(auth, 'care-recaptcha', { size: 'invisible' });
      const result = await signInWithPhoneNumber(auth, phone.replaceAll(' ', ''), verifier);
      setConfirmation(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      const cred = await confirmation.confirm(code.trim());
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/api/v1/care/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const body = (await res.json()) as { onboarded?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Sign-in failed');
      router.push(body.onboarded ? '/care/home' : '/care/onboarding');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-10">
      <h1 className="font-serif text-3xl font-semibold">Let&apos;s get you in</h1>
      <p className="mt-2 text-[15px] text-[var(--color-ink-2)]">
        New or returning — same door. We&apos;ll text a 6-digit code.
      </p>

      {!configured ? (
        <Card className="mt-6 p-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            Demo mode — phone sign-in is off in this environment.
          </p>
          <Button className="mt-3 w-full" onClick={() => router.push('/care/home')}>
            Continue as the demo user
          </Button>
        </Card>
      ) : !confirmation ? (
        <Card className="mt-6 p-4">
          <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            Phone
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-[15px] font-semibold tracking-normal"
            />
          </label>
          <div id="care-recaptcha" />
          {error ? <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p> : null}
          <Button className="mt-4 w-full" disabled={busy} onClick={() => void sendCode()}>
            {busy ? 'Sending…' : 'Text me the code'}
          </Button>
        </Card>
      ) : (
        <Card className="mt-6 p-4">
          <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            Enter code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-center text-xl font-bold tracking-[0.4em]"
            />
          </label>
          {error ? <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p> : null}
          <Button
            className="mt-4 w-full"
            disabled={busy || code.trim().length < 6}
            onClick={() => void verify()}
          >
            {busy ? 'Verifying…' : 'Verify & continue'}
          </Button>
        </Card>
      )}

      <p className="mt-4 text-xs text-[var(--color-ink-3)]">
        By continuing you confirm you&apos;re 18 or older.
      </p>
    </div>
  );
}
