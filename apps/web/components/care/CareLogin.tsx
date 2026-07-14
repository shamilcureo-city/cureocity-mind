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
 *
 * `demoMode` is the SERVER's auth-bypass truth (from the page). The demo
 * door only works when the server resolves the seeded demo user — i.e.
 * when bypass is on — so we gate the demo button on that, NOT on the
 * client Firebase keys (a separate signal that can diverge: e.g. server
 * Firebase set but the public NEXT_PUBLIC_FIREBASE_* keys missing would
 * otherwise show a demo button that just bounces off /care/home). When
 * neither demo nor phone sign-in is available, we say so plainly instead
 * of offering a button that goes nowhere.
 */
export function CareLogin({ demoMode = false }: { demoMode?: boolean }) {
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

  async function verify(codeOverride?: string): Promise<void> {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      const cred = await confirmation.confirm(codeOverride ?? code.trim());
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

      {demoMode ? (
        <Card className="mt-6 p-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            Demo mode — phone sign-in is off in this environment.
          </p>
          <Button className="mt-3 w-full" onClick={() => router.push('/care/home')}>
            Continue as the demo user
          </Button>
        </Card>
      ) : !configured ? (
        <Card className="mt-6 p-4">
          <p className="text-sm font-medium text-[var(--color-ink)]">
            Sign-in isn&apos;t available on this deployment yet.
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Phone sign-in needs the Firebase keys configured here. To open this environment as a
            demo instead, set <code className="text-[13px]">AUTH_BYPASS=true</code> and redeploy.
          </p>
        </Card>
      ) : !confirmation ? (
        <Card className="mt-6 p-4">
          <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            Phone
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-[15px] font-semibold tracking-normal"
            />
          </label>
          <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
            No email. No real name yet. Just a number so your sessions stay yours — no calls, no
            marketing, only messages you switch on.
          </p>
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
              onChange={(e) => {
                const v = e.target.value;
                setCode(v);
                // Zero-friction: the code autofills on most phones — submit
                // the moment the 6th digit lands.
                if (v.trim().length === 6 && !busy) void verify(v.trim());
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-center text-xl font-bold tracking-[0.4em]"
            />
          </label>
          <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
            Check your messages — it autofills on most phones.
          </p>
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
