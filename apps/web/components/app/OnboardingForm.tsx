'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';
import { FieldError, Input, Label } from '../ui/Field';

interface Props {
  /// Phone is captured from the OTP login and is shown read-only here
  /// — therapists change it via the recovery flow, not this form.
  phone: string;
}

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ta', label: 'Tamil' },
  { value: 'bn', label: 'Bengali' },
];

/**
 * Sprint 31 — one-shot onboarding form.
 *
 * Replaces the placeholder identity fields the auth/session route
 * auto-provisions on first login (fullName "New therapist", email
 * `<uid>@unclaimed.cureocity.app`, rciNumber `PENDING-<uid>`).
 * Phone is captured from Firebase OTP and is read-only here.
 *
 * On success: page refreshes — the now-onboarded guard lets the
 * router land on /app.
 */
export function OnboardingForm({ phone }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [rciNumber, setRciNumber] = useState('');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          rciNumber: rciNumber.trim(),
          defaultOutputLanguage: language,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Could not save (${res.status}).`);
      }
      router.replace('/app');
      // Refresh so the server-side onboarding gate re-reads.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          autoComplete="name"
          required
          minLength={2}
          maxLength={200}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Dr. Priya Menon"
        />
      </div>

      <div>
        <Label htmlFor="email" hint="Used for receipts and account recovery">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="priya@yourpractice.in"
        />
      </div>

      <div>
        <Label htmlFor="rciNumber" hint="RCI registration number — self-attested for now">
          RCI number
        </Label>
        <Input
          id="rciNumber"
          required
          minLength={3}
          maxLength={40}
          value={rciNumber}
          onChange={(e) => setRciNumber(e.target.value)}
          placeholder="A-12345"
        />
      </div>

      <div>
        <Label htmlFor="language" hint="Used for the notes, briefs, and patient-facing copy">
          Default output language
        </Label>
        <select
          id="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-white px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="phone" hint="From your sign-in OTP — change via recovery">
          Phone
        </Label>
        <Input id="phone" value={phone} readOnly disabled className="bg-[var(--color-surface-soft)]" />
      </div>

      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? 'Saving…' : 'Finish setup'}
      </Button>
      <FieldError message={error} />

      <p className="text-xs text-[var(--color-ink-3)]">
        We&rsquo;ll review your RCI number out of band and mark it verified on your profile.
        Recording and notes work right away — verification just adds a badge.
      </p>
    </form>
  );
}
