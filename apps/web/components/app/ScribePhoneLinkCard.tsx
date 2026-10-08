'use client';

import { useEffect, useRef, useState } from 'react';
import type { RecaptchaVerifier } from 'firebase/auth';
import {
  beginPractitionerPhoneLink,
  practitionerPhoneLinkError,
} from '@/lib/practitioner-phone-link';
import { createRecaptchaVerifier } from '@/lib/firebase-therapist';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Label } from '../ui/Field';

export function ScribePhoneLinkCard({ expectedUid }: { expectedUid: string }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<Awaited<
    ReturnType<typeof beginPractitionerPhoneLink>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const verifier = useRef<RecaptchaVerifier | null>(null);
  useEffect(
    () => () => {
      verifier.current?.clear();
    },
    [],
  );

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!/^\+[1-9]\d{7,14}$/.test(phone))
        throw new Error('Enter an international phone number, for example +971501234567.');
      verifier.current ??= createRecaptchaVerifier('scribe-phone-link-captcha');
      setPending(await beginPractitionerPhoneLink(expectedUid, phone, verifier.current));
    } catch (error) {
      setError(practitionerPhoneLinkError(error));
      verifier.current?.clear();
      verifier.current = null;
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (busy || !pending) return;
    setBusy(true);
    setError(null);
    try {
      await pending.confirm(code);
      setDone(true);
      setPending(null);
    } catch (error) {
      setError(practitionerPhoneLinkError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mt-6 space-y-4 p-6">
      <h2 className="font-serif text-2xl">Link phone sign-in</h2>
      <p className="text-sm">
        Keep your Google or email sign-in and add SMS verification to the same account. This does
        not change your profile contact number.
      </p>
      {done ? (
        <p role="status">Phone sign-in linked. Your original sign-in is unchanged.</p>
      ) : (
        <>
          <div>
            <Label htmlFor="scribe-link-phone">Phone number</Label>
            <Input
              id="scribe-link-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              disabled={busy || !!pending}
              onChange={(event) => setPhone(event.target.value.replace(/\s/g, ''))}
              placeholder="+971501234567"
            />
          </div>
          {pending ? (
            <>
              <div>
                <Label htmlFor="scribe-link-code">SMS code</Label>
                <Input
                  id="scribe-link-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <Button onClick={() => void confirm()} disabled={busy || code.length !== 6}>
                {busy ? 'Verifying…' : 'Verify and link phone'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setCode('');
                  verifier.current?.clear();
                  verifier.current = null;
                }}
              >
                Use another number or request a new code
              </Button>
            </>
          ) : (
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? 'Sending…' : 'Send verification code'}
            </Button>
          )}
        </>
      )}
      <div id="scribe-phone-link-captcha" />
      {error && (
        <p role="alert" className="text-sm text-[var(--color-warn)]">
          {error}{' '}
          <a
            href="mailto:shamil@cureo.city?subject=Scribe%20sign-in%20recovery"
            className="underline"
          >
            Contact support
          </a>
        </p>
      )}
    </Card>
  );
}
