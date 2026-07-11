'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { CareResource } from './SafetyStrip';
import { CrisisTakeover } from './CrisisTakeover';

const PERSONAS = [
  { name: 'Meera', voiceName: 'Kore', style: 'gentle', blurb: 'gentle · unhurried' },
  { name: 'Dev', voiceName: 'Puck', style: 'direct', blurb: 'direct · warm' },
  { name: 'Asha', voiceName: 'Aoede', style: 'gentle', blurb: 'calm · bright' },
] as const;

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'bn', label: 'বাংলা' },
] as const;

/**
 * Onboarding (AC1, S3) — deliberately short: the real intake happens in
 * session 1, as a conversation. Three steps: name + therapist pick →
 * languages → the honesty screen (18+, consent, baseline safety
 * question, optional trusted contact).
 */
export function CareOnboardingFlow({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(initialName);
  const [persona, setPersona] = useState(0);
  const [langs, setLangs] = useState<string[]>(['en']);
  const [isAdult, setIsAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [safetyAnswer, setSafetyAnswer] = useState<null | boolean>(null);
  const [tcName, setTcName] = useState('');
  const [tcPhone, setTcPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heldResources, setHeldResources] = useState<CareResource[] | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const p = PERSONAS[persona]!;
      const res = await fetch('/api/v1/care/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || 'Friend',
          personaName: p.name,
          voiceName: p.voiceName,
          personaStyle: p.style,
          preferredLanguage: langs[0] ?? 'en',
          spokenLanguages: langs,
          isAdult: true,
          consentAccepted: true,
          hasActiveSelfHarmThoughts: safetyAnswer === true,
          ...(tcName.trim() ? { trustedContactName: tcName.trim() } : {}),
          ...(tcPhone.trim() ? { trustedContactPhone: tcPhone.trim() } : {}),
        }),
      });
      const body = (await res.json()) as {
        status?: string;
        resources?: CareResource[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? 'Something went wrong');
      if (body.status === 'SAFETY_HOLD') {
        setHeldResources(body.resources ?? []);
        return;
      }
      router.push('/care/home');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (heldResources) {
    // Baseline gate said "yes" — humans first, never the AI (§2 layer 2).
    return <CrisisTakeover resources={heldResources} trustedContact={null} />;
  }

  return (
    <div className="mx-auto max-w-md px-5 py-8 pb-20">
      <div className="mb-6 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded ${i <= step ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-soft)]'}`}
          />
        ))}
      </div>

      {step === 0 ? (
        <>
          <h1 className="font-serif text-2xl font-semibold">Who feels right?</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Same training, different presence. You can change later.
          </p>
          <label className="mt-5 block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            What should we call you?
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-[15px] font-normal normal-case tracking-normal"
              maxLength={80}
            />
          </label>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {PERSONAS.map((p, i) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setPersona(i)}
                className={`rounded-2xl border p-3 text-center text-sm ${
                  persona === i
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)]'
                }`}
              >
                <span className="mx-auto mb-1.5 block h-9 w-9 rounded-full bg-[radial-gradient(circle_at_35%_30%,#9fd3bd,#3f8a6d_65%)]" />
                <span className="block font-semibold">{p.name}</span>
                <span className="block text-[11px] text-[var(--color-ink-3)]">{p.blurb}</span>
              </button>
            ))}
          </div>
          <Button className="mt-6 w-full" onClick={() => setStep(1)}>
            Continue
          </Button>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <h1 className="font-serif text-2xl font-semibold">Languages you speak</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Your therapist mirrors your mix — Manglish and Hinglish welcome.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {LANGS.map((l) => {
              const on = langs.includes(l.code);
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() =>
                    setLangs((cur) => (on ? cur.filter((c) => c !== l.code) : [...cur, l.code]))
                  }
                  className={`rounded-full border px-4 py-1.5 text-sm ${
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                      : 'border-[var(--color-line)] bg-[var(--color-surface)]'
                  }`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          <Button className="mt-6 w-full" onClick={() => setStep(2)} disabled={langs.length === 0}>
            Continue
          </Button>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 className="font-serif text-2xl font-semibold">Honest, before we start</h1>
          <Card className="mt-4 space-y-3 p-4 text-sm">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={isAdult}
                onChange={(e) => setIsAdult(e.target.checked)}
                className="mt-0.5"
              />
              <span>I am 18 or older.</span>
            </label>
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I understand my therapist is an <b>AI</b> (not a licensed professional), my voice is
                processed into a transcript (including outside India) to run my sessions and write
                my reports, and I can export or delete everything in Settings.
              </span>
            </label>
          </Card>
          <Card className="mt-3 border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] p-4 text-sm">
            <p className="font-medium">Are you currently having thoughts of harming yourself?</p>
            <p className="mt-1 text-xs opacity-80">
              A yes takes you to people who can help right now — not to the AI.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setSafetyAnswer(false)}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  safetyAnswer === false
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                    : 'border-[var(--color-line)] bg-white'
                }`}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => setSafetyAnswer(true)}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  safetyAnswer === true
                    ? 'border-[var(--color-warn)] bg-[var(--color-warn)] text-white'
                    : 'border-[var(--color-line)] bg-white'
                }`}
              >
                Yes
              </button>
            </div>
          </Card>
          <Card className="mt-3 p-4 text-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Trusted contact (optional)
            </p>
            <p className="mt-1 text-xs text-[var(--color-ink-3)]">
              Shown to you — only you — as a one-tap call if things get heavy. Never messaged
              automatically.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                placeholder="Name"
                value={tcName}
                onChange={(e) => setTcName(e.target.value)}
                className="w-1/2 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm"
                maxLength={80}
              />
              <input
                placeholder="Phone"
                value={tcPhone}
                onChange={(e) => setTcPhone(e.target.value)}
                className="w-1/2 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm"
                maxLength={24}
              />
            </div>
          </Card>
          {error ? <p className="mt-3 text-sm text-[var(--color-warn)]">{error}</p> : null}
          <Button
            className="mt-6 w-full"
            disabled={!isAdult || !consent || safetyAnswer === null || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Setting things up…' : "I'm ready"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
