'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';
import { FieldError, Input, Label } from '../ui/Field';

interface Props {
  /// Phone from the auto-provision row. OTP signups arrive with a real
  /// E.164 number; Google/email signups arrive with a `pending:<uid>`
  /// placeholder — in that case we let the user set it here.
  phone: string;
}

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ta', label: 'Tamil' },
  { value: 'bn', label: 'Bengali' },
];

const COUNTRY_CODES = [
  { dial: '91', iso2: 'IN', flag: '🇮🇳' },
  { dial: '1', iso2: 'US', flag: '🇺🇸' },
  { dial: '44', iso2: 'UK', flag: '🇬🇧' },
  { dial: '971', iso2: 'AE', flag: '🇦🇪' },
  { dial: '65', iso2: 'SG', flag: '🇸🇬' },
  { dial: '61', iso2: 'AU', flag: '🇦🇺' },
] as const;

/**
 * Sprint 31 — one-shot onboarding form. Mobile number is editable only
 * when the auto-provision stored a `pending:` placeholder (Google / email
 * signup); a real OTP-verified phone stays read-only and is changed via
 * the recovery flow.
 */
export function OnboardingForm({ phone }: Props) {
  const router = useRouter();
  const phoneIsPlaceholder = phone.startsWith('pending:');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [rciNumber, setRciNumber] = useState('');
  const [language, setLanguage] = useState('en');
  const [countryCode, setCountryCode] = useState('91');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        fullName: fullName.trim(),
        email: email.trim(),
        rciNumber: rciNumber.trim(),
        defaultOutputLanguage: language,
      };
      if (phoneIsPlaceholder && phoneDigits.length >= 6) {
        body['phone'] = `+${countryCode}${phoneDigits}`;
      }
      const res = await fetch('/api/v1/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? `Could not save (${res.status}).`);
      }
      router.replace('/app');
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
        <Label
          htmlFor="phone"
          hint={
            phoneIsPlaceholder
              ? 'Optional — leave blank to add later in Settings'
              : 'From your sign-in OTP — change via recovery'
          }
        >
          {phoneIsPlaceholder ? 'Mobile number' : 'Phone'}
        </Label>
        {phoneIsPlaceholder ? (
          <div className="flex items-stretch gap-0 overflow-hidden rounded-xl border border-[var(--color-line)] bg-white focus-within:border-[var(--color-accent)] focus-within:ring-2 focus-within:ring-[var(--color-accent)]/15">
            <label htmlFor="cc" className="sr-only">
              Country code
            </label>
            <select
              id="cc"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="border-r border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2.5 text-sm font-medium text-[var(--color-ink)] focus:outline-none"
              aria-label="Country code"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.dial} value={c.dial}>
                  {c.flag} +{c.dial} {c.iso2}
                </option>
              ))}
            </select>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              value={phoneDigits}
              onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 14))}
              autoComplete="tel-national"
              placeholder={countryCode === '91' ? '98765 43210' : 'mobile number'}
              maxLength={14}
              className="flex-1 bg-white px-3 py-2.5 text-sm tracking-wide outline-none placeholder:text-[var(--color-ink-3)]"
            />
          </div>
        ) : (
          <Input id="phone" value={phone} readOnly disabled className="bg-[var(--color-surface-soft)]" />
        )}
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
