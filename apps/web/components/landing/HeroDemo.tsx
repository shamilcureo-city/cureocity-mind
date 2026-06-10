'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Sprint 34 — the hero's looping product demo.
 *
 * Three phases, then loop:
 *   listening — live waveform + a code-mix transcript line
 *   drafting  — the four SOAP lines type themselves out
 *   signed    — "Signed · biometric" badge pops, short hold
 *
 * Everything is driven by one rAF-free interval; reduced-motion users
 * get the finished state immediately (no loop, no typing).
 *
 * The copy is the product's real shape: a Hinglish subjective quote
 * (Pass 1 is code-mix-first), a PHQ-9 score in the assessment (Sprint
 * 17 instruments), and a concrete plan. Keep it short — it's read in
 * ~2 seconds while typing.
 */

const TRANSCRIPT_LINE = '“Raat ko neend hi nahi aati… exam ka pressure bahut zyada hai.”';

const SOAP_LINES: { label: string; text: string }[] = [
  { label: 'S', text: 'Two weeks of poor sleep; exam stress. Worst around 2 a.m.' },
  { label: 'O', text: 'Tearful early in session, settled by mid-point. Speech normal.' },
  { label: 'A', text: 'Acute stress reaction, mild–moderate. PHQ-9 today: 11.' },
  { label: 'P', text: 'Sleep-hygiene plan + 4-7-8 breathing nightly. Review in 1 week.' },
];

type Phase = 'listening' | 'drafting' | 'signed';

const LISTEN_MS = 3200;
const SIGNED_HOLD_MS = 3400;
const TYPE_TICK_MS = 16;
const CHARS_PER_TICK = 2;

/** Deterministic waveform bar heights — Math.random would mismatch SSR. */
const BAR_HEIGHTS = [
  38, 62, 50, 78, 44, 90, 58, 70, 36, 82, 54, 66, 42, 88, 60, 48, 74, 40, 84, 56, 68, 46, 80, 52,
];

export function HeroDemo() {
  const [phase, setPhase] = useState<Phase>('listening');
  const [typedCount, setTypedCount] = useState(0);
  const [reduced, setReduced] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalChars = SOAP_LINES.reduce((n, l) => n + l.text.length, 0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      setReduced(true);
      setPhase('signed');
      setTypedCount(totalChars);
      return;
    }

    let cancelled = false;
    let phaseTimeout: ReturnType<typeof setTimeout> | null = null;

    const startListening = () => {
      if (cancelled) return;
      setPhase('listening');
      setTypedCount(0);
      phaseTimeout = setTimeout(startDrafting, LISTEN_MS);
    };

    const startDrafting = () => {
      if (cancelled) return;
      setPhase('drafting');
      let n = 0;
      timerRef.current = setInterval(() => {
        n += CHARS_PER_TICK;
        if (n >= totalChars) {
          if (timerRef.current) clearInterval(timerRef.current);
          setTypedCount(totalChars);
          phaseTimeout = setTimeout(startSigned, 500);
        } else {
          setTypedCount(n);
        }
      }, TYPE_TICK_MS);
    };

    const startSigned = () => {
      if (cancelled) return;
      setPhase('signed');
      phaseTimeout = setTimeout(startListening, SIGNED_HOLD_MS);
    };

    startListening();
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (phaseTimeout) clearTimeout(phaseTimeout);
    };
  }, [totalChars]);

  // Slice the global typed-char budget across the four lines in order.
  let budget = typedCount;
  const lines = SOAP_LINES.map((l) => {
    const take = Math.max(0, Math.min(l.text.length, budget));
    budget -= take;
    return { ...l, shown: l.text.slice(0, take), active: take > 0 && take < l.text.length };
  });
  const lastStartedIdx = lines.reduce((acc, l, i) => (l.shown.length > 0 ? i : acc), -1);

  return (
    <div
      className={`relative rounded-3xl border border-[var(--color-line)] bg-white p-6 shadow-[0_32px_80px_-36px_rgba(15,27,42,0.28)] ${
        phase === 'listening' ? 'lp-live' : ''
      }`}
      aria-label="Product demo: a recorded session becoming a signed SOAP note"
    >
      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-ink-2)]">
          {phase === 'listening' && (
            <>
              <span aria-hidden className="lp-rec-dot h-2 w-2 rounded-full bg-red-500" />
              Recording session
            </>
          )}
          {phase === 'drafting' && (
            <>
              <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              Drafting note
            </>
          )}
          {phase === 'signed' && (
            <>
              <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              Ready in your language
            </>
          )}
        </div>
        <span className="rounded-full bg-[var(--color-surface-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          47:12
        </span>
      </div>

      {/* Waveform */}
      <div className="mt-4 flex h-14 items-center gap-[3px]" aria-hidden>
        {BAR_HEIGHTS.map((h, i) => (
          <span
            key={i}
            className="lp-wavebar w-full rounded-full bg-[var(--color-accent)]/70"
            style={{
              height: `${h}%`,
              ['--lp-bar-delay' as string]: `${(i % 7) * 90}ms`,
              opacity: phase === 'listening' ? 1 : 0.25,
              transition: 'opacity 0.5s ease',
            }}
          />
        ))}
      </div>

      {/* Transcript line (code-mix) */}
      <p
        className="mt-3 min-h-10 rounded-xl bg-[var(--color-surface-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-2)]"
        style={{ opacity: phase === 'listening' || reduced ? 1 : 0.45, transition: 'opacity 0.5s ease' }}
      >
        <span className="mr-2 inline-block rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          hi-en
        </span>
        {TRANSCRIPT_LINE}
      </p>

      {/* SOAP lines */}
      <div className="mt-4 space-y-2.5">
        {lines.map((l, i) => (
          <div key={l.label} className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${
                l.shown.length > 0
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'bg-[var(--color-surface-soft)] text-[var(--color-ink-3)]'
              }`}
              style={{ transition: 'background-color 0.3s ease, color 0.3s ease' }}
            >
              {l.label}
            </span>
            <p className="min-h-6 flex-1 text-[13px] leading-6 text-[var(--color-ink)]">
              {l.shown}
              {phase === 'drafting' && i === lastStartedIdx && <span className="lp-caret ml-0.5" />}
            </p>
          </div>
        ))}
      </div>

      {/* Signed badge */}
      <div className="mt-5 flex h-9 items-center justify-between">
        <span className="text-[11px] text-[var(--color-ink-3)]">
          You review and edit before anything is final.
        </span>
        {phase === 'signed' && (
          <span className="lp-pop inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M20 6L9 17l-5-5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Signed · biometric
          </span>
        )}
      </div>
    </div>
  );
}
