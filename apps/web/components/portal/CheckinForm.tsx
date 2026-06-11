'use client';

import { useMemo, useState } from 'react';
import type { CrisisHotline } from '@cureocity/clinical';

interface CheckinItem {
  id: string;
  number: number;
  text: string;
}
interface CheckinScaleOption {
  value: number;
  label: string;
}

interface Props {
  token: string;
  clientFirstName: string;
  // The clinical instrument title ("Depression screen") and key are
  // intentionally NOT shown to the patient — the warm portal subject +
  // the recall-window instruction frame the form without a clinical
  // label. The submit route resolves the instrument from the token.
  recallWindow: string;
  items: CheckinItem[];
  scale: CheckinScaleOption[];
  /** 1-based number of the suicidality item (PHQ-9 #9), or null. */
  riskItemNumber: number | null;
  crisisHotlines: CrisisHotline[];
}

/**
 * Sprint 47 — the self-serve check-in form on the patient portal.
 *
 * The client answers each item; on submit we POST to the public
 * /p/[token]/checkin route which scores + stores the response.
 *
 * Safety is built into the form, not bolted on: the moment the client
 * endorses the self-harm item (PHQ-9 #9) we surface India crisis
 * resources inline — a clinician isn't in the room, so the support
 * has to appear immediately, before and independent of submitting.
 */
export function CheckinForm({
  token,
  clientFirstName,
  recallWindow,
  items,
  scale,
  riskItemNumber,
  crisisHotlines,
}: Props) {
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const riskItemId = useMemo(
    () => (riskItemNumber ? (items.find((i) => i.number === riskItemNumber)?.id ?? null) : null),
    [items, riskItemNumber],
  );
  const riskEndorsed = riskItemId !== null && (responses[riskItemId] ?? 0) > 0;
  const allAnswered = items.every((i) => responses[i.id] !== undefined);

  async function submit() {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/p/${token}/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responses }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not submit (${res.status})`);
      }
      setSubmitted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <article className="space-y-4">
        <div className="rounded-2xl bg-[var(--color-accent-soft)] p-6 text-center">
          <p className="font-serif text-xl text-[var(--color-ink)]">Thank you, {clientFirstName}.</p>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            Your answers have been saved and sent to your therapist. They&apos;ll review them
            before your next session.
          </p>
        </div>
        {riskEndorsed && <CrisisPanel hotlines={crisisHotlines} />}
      </article>
    );
  }

  return (
    <article className="space-y-5">
      <p className="text-sm text-[var(--color-ink-2)]">
        Hi {clientFirstName}, your therapist has asked you to fill this in before your next
        session. It takes about a minute. There are no right or wrong answers — just choose what
        feels closest.
      </p>
      <p className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4 text-sm font-medium text-[var(--color-ink)]">
        {recallWindow}
      </p>

      <ol className="space-y-4">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4"
          >
            <p className="text-sm font-medium text-[var(--color-ink)]">
              {item.number}. {item.text}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {scale.map((opt) => {
                const selected = responses[item.id] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setResponses((r) => ({ ...r, [item.id]: opt.value }))}
                    className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
                        : 'border-[var(--color-line-soft)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      {/* Safety net — surfaced the instant the self-harm item is endorsed. */}
      {riskEndorsed && <CrisisPanel hotlines={crisisHotlines} />}

      {error && (
        <p className="text-sm text-[var(--color-warn)]" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!allAnswered || submitting}
        className="w-full rounded-full bg-[var(--color-accent)] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Saving…' : allAnswered ? 'Send to my therapist' : 'Answer every question to continue'}
      </button>
    </article>
  );
}

/**
 * Calm, supportive crisis-resource panel. Shown to the client the
 * moment they endorse the self-harm item — warm tone, real numbers,
 * tap-to-call. Not alarming; reassuring.
 */
function CrisisPanel({ hotlines }: { hotlines: CrisisHotline[] }) {
  return (
    <section
      role="alert"
      className="rounded-2xl border-2 border-[#9f1f1f] bg-[#fbe1de] p-5 text-[#7f1010]"
    >
      <p className="font-serif text-lg">You don&apos;t have to go through this alone.</p>
      <p className="mt-2 text-sm leading-relaxed">
        It looks like you&apos;ve been having some really hard thoughts. That can feel heavy to
        carry. These free, confidential lines have trained people who want to listen — you can
        reach out right now.
      </p>
      <ul className="mt-4 space-y-2">
        {hotlines.map((h) => (
          <li
            key={h.name}
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-white/70 px-4 py-3"
          >
            <div>
              <a
                href={`tel:${h.number.replace(/[^+\d]/g, '')}`}
                className="text-base font-semibold underline"
              >
                {h.name}
              </a>
              <p className="text-xs">{h.description}</p>
            </div>
            <div className="text-right text-sm">
              <a href={`tel:${h.number.replace(/[^+\d]/g, '')}`} className="font-mono font-semibold">
                {h.number}
              </a>
              <p className="text-xs">{h.hours}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs">
        If you are in immediate danger, please call <strong>112</strong> (emergency services) or go
        to your nearest hospital.
      </p>
    </section>
  );
}
