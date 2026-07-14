'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PHQ9 } from '@cureocity/clinical';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { CareResource } from './SafetyStrip';

/**
 * CG5 — the anonymous PHQ-9 (client-side only). Scoring happens in the
 * browser from the validated registry; no network call carries answers
 * anywhere. Item 9 > 0 or a severe band renders crisis resources INLINE —
 * crisis support for strangers is free, full stop, and never behind a
 * signup wall. The handoff into onboarding is explicit-consent-only.
 */
export function CareAnonymousCheck({
  resources,
  signupsOpen,
}: {
  resources: CareResource[];
  signupsOpen: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const answered = Object.keys(answers).length;
  const complete = answered === PHQ9.items.length;
  const score = useMemo(() => Object.values(answers).reduce((a, b) => a + b, 0), [answers]);
  const band = useMemo(
    () => PHQ9.severityBands.find((b) => score >= b.min && score <= b.max),
    [score],
  );
  const riskItem = PHQ9.items[PHQ9.riskItemNumber! - 1]!;
  const riskRaised = (answers[riskItem.id] ?? 0) > 0;
  const severe = band ? band.min >= 15 : false;

  function carryAndGo(): void {
    // Explicit consent — the button IS the consent (the silent handoff was
    // a DPDP violation, cut by the ethics review).
    try {
      sessionStorage.setItem(
        'care-check-handoff',
        JSON.stringify({ instrument: 'PHQ9', score, at: Date.now() }),
      );
    } catch {
      /* private mode — the warm start just doesn't happen */
    }
  }

  const resultWords =
    band && band.key.includes('minimal')
      ? 'This looks light right now. If talking would still help — it usually does — the door is open.'
      : band && score < 15
        ? `This looks like ${band.label.en.toLowerCase()} — the kind of heavy that talking helps with. Not a diagnosis; an honest signal.`
        : 'This looks genuinely heavy. Not a diagnosis — but worth taking seriously, and worth not carrying alone.';

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 md:max-w-2xl">
      <h1 className="font-serif text-3xl font-semibold">How heavy is it, really?</h1>
      <p className="mt-2 text-[15px] text-[var(--color-ink-2)]">
        The same 2-minute check-in clinicians use (PHQ-9). No sign-up. Nothing stored. A straight
        answer.
      </p>

      {!submitted ? (
        <Card className="mt-5 p-4">
          <p className="text-[12px] text-[var(--color-ink-3)]">
            {PHQ9.recallWindow.en} · {answered}/{PHQ9.items.length} answered
          </p>
          <div className="mt-3 space-y-4">
            {PHQ9.items.map((item) => (
              <div key={item.id}>
                <p className="text-sm">{item.text.en}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup">
                  {PHQ9.scale.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={answers[item.id] === opt.value}
                      onClick={() => setAnswers((cur) => ({ ...cur, [item.id]: opt.value }))}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        answers[item.id] === opt.value
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                          : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-2)]'
                      }`}
                    >
                      {opt.label.en}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button className="mt-4 w-full" disabled={!complete} onClick={() => setSubmitted(true)}>
            {complete ? 'Show me the honest answer' : `${PHQ9.items.length - answered} to go`}
          </Button>
        </Card>
      ) : (
        <>
          {riskRaised || severe ? (
            <Card className="mt-5 border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] p-4">
              <p className="text-sm font-medium">
                Some of your answers deserve a person, right now — not an app.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {resources.map((r) => (
                  <li key={r.number}>
                    <a href={`tel:${r.number}`} className="font-semibold underline-offset-2">
                      {r.name} — {r.number}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--color-ink-2)]">
                Free, confidential, in Hindi and English.
              </p>
            </Card>
          ) : null}
          <Card className="mt-3 p-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Your answer
            </span>
            <p className="mt-1.5 text-sm">
              <b>
                {score}/27 — the &ldquo;{band?.label.en.toLowerCase()}&rdquo; range.
              </b>{' '}
              {resultWords}
            </p>
            <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
              One person&apos;s numbers on one evening — not a promise, not a diagnosis.
            </p>
          </Card>
          {!riskRaised ? (
            <Card className="mt-3 p-4">
              {signupsOpen ? (
                <>
                  <p className="text-sm">
                    Talk it through tonight — a real voice session, free, in your language. Your
                    therapist is an AI, and we say it plainly.
                  </p>
                  <Button
                    className="mt-3 w-full"
                    onClick={() => {
                      carryAndGo();
                      router.push('/care/login');
                    }}
                  >
                    Talk it through tonight — free
                  </Button>
                  <p className="mt-1.5 text-center text-[11px] text-[var(--color-ink-3)]">
                    Tapping this carries tonight&apos;s score into your first session so it opens
                    warm — that&apos;s the only place it goes.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    Real voice sessions are opening soon — 2 a week, free, in your language.
                  </p>
                  <ButtonLink href="/care" variant="secondary" className="mt-3 w-full">
                    Join the waitlist →
                  </ButtonLink>
                </>
              )}
            </Card>
          ) : null}
          <p className="mt-4 text-center">
            <Link
              href="/care"
              className="text-sm text-[var(--color-ink-3)] underline-offset-2 hover:underline"
            >
              ← About Cureocity Care
            </Link>
          </p>
        </>
      )}
      <p className="mt-8 text-[11px] leading-relaxed text-[var(--color-ink-3)]">
        Cureocity Care is AI software, not a person, and not a medical diagnosis, treatment, or a
        replacement for professional care. Not for emergencies — in a crisis, contact local
        emergency services or the numbers above.
      </p>
    </main>
  );
}
