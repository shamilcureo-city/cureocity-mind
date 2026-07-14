'use client';

import { useMemo, useState } from 'react';
import { INSTRUMENTS, type InstrumentKey } from '@cureocity/clinical';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { CareResource } from './SafetyStrip';
import { CrisisTakeover } from './CrisisTakeover';

/**
 * CG1 — the measurement loop's front door (docs/CARE_GROWTH_SYSTEM.md §5).
 * The PHQ-9/GAD-7 backend (scoring, item-9 tripwire, reliable change) was
 * fully built with zero UI callers; this form activates it. Framed as a
 * "starting line" / "check-in", never a test: exact validated item wording
 * from the @cureocity/clinical registry, skippable with an honest cost
 * line, and the score is shown in plain words — never as a grade.
 *
 * A flagged item 9 routes to the warm CrisisTakeover (the route sets the
 * SAFETY_HOLD); the copy tells the user their assessment is saved and
 * waiting — the report is never withheld.
 */

interface SubmitResult {
  totalScore: number;
  severityLabel: string;
  safetyHold: boolean;
  resources?: CareResource[];
}

export function CareInstrumentForm({
  instrumentKey = 'PHQ9',
  framing,
  onDone,
  onSkip,
}: {
  instrumentKey?: InstrumentKey;
  /** 'baseline' = the post-plan-accept starting line; 'review' = the pre-review check-in. */
  framing: 'baseline' | 'review';
  onDone: () => void;
  onSkip?: () => void;
}) {
  const definition = INSTRUMENTS[instrumentKey];
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const maxScore = useMemo(
    () => definition.items.length * Math.max(...definition.scale.map((s) => s.value)),
    [definition],
  );
  const answered = Object.keys(answers).length;
  const complete = answered === definition.items.length;

  async function submit(): Promise<void> {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/care/instruments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instrumentKey, answers }),
      });
      const body = (await res.json()) as SubmitResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save your answers');
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result?.safetyHold) {
    // Item 9 was raised. Humans first — and the report stays saved for later.
    return <CrisisTakeover resources={result.resources ?? []} trustedContact={null} />;
  }

  if (result) {
    return (
      <Card className="mt-3 p-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          {framing === 'baseline' ? 'Your starting line' : 'Before your review'}
        </span>
        <p className="mt-2 text-sm">
          Done — <b>{result.totalScore}</b>/{maxScore}, the &ldquo;
          {result.severityLabel.toLowerCase()}&rdquo; range.{' '}
          {framing === 'baseline'
            ? 'Numbers aren’t the story — but they’ll tell us when the story changes. Sealed until your review: no grades, no judgment.'
            : 'Both photos are in now — your review can show real change, not vibes.'}
        </p>
        <Button className="mt-3 w-full" onClick={onDone}>
          {framing === 'baseline' ? 'Done for tonight →' : 'Continue →'}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="mt-3 p-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        {framing === 'baseline' ? 'One last thing — your starting line' : 'Before your review'}
      </span>
      <p className="mt-1.5 text-sm text-[var(--color-ink-2)]">
        {framing === 'baseline'
          ? `${definition.items.length} questions, about 90 seconds — the same form clinicians use. Your review measures against tonight, so you’ll know if this is really working, not just feeling different.`
          : `The same ${definition.items.length} questions from day one. ${'Meera'} can’t show you real change without today’s number.`}
      </p>
      <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
        {definition.recallWindow.en} · {answered}/{definition.items.length} answered
      </p>

      <div className="mt-3 space-y-4">
        {definition.items.map((item) => (
          <div key={item.id}>
            <p className="text-sm">{item.text.en}</p>
            <div
              className="mt-1.5 flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label={item.text.en}
            >
              {definition.scale.map((opt) => (
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

      {error ? <p className="mt-3 text-sm text-[var(--color-warn)]">{error}</p> : null}
      <Button className="mt-4 w-full" disabled={!complete || busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : complete ? 'Done ✓' : `${definition.items.length - answered} to go`}
      </Button>
      {onSkip ? (
        <button
          type="button"
          onClick={onSkip}
          className="mt-2 w-full text-center text-[12px] text-[var(--color-ink-3)] underline-offset-2 hover:underline"
        >
          {framing === 'baseline'
            ? 'Later is fine — without it, your review can’t show real change'
            : 'Skip for now — the review will run without a fresh number'}
        </button>
      ) : null}
    </Card>
  );
}
