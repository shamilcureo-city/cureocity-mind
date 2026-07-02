'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClinicQueueSchema, type ClinicQueueEntry } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

/**
 * Sprint DS7 — turnover. Once the note has landed, arm the next token with
 * a short countdown so the doctor moves patient-to-patient without going
 * back to the queue (target ≤10 s between consults). Hold pauses it; Go now
 * jumps immediately. Voice "wait" holding the countdown is deferred — the
 * consult mic is stopped at End, so it needs a separate always-on listener.
 * See docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS7.
 */
const TURNOVER_SECONDS = 10;

export function TurnoverBar({ currentSessionId }: { currentSessionId: string }) {
  const router = useRouter();
  const [next, setNext] = useState<ClinicQueueEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [left, setLeft] = useState(TURNOVER_SECONDS);
  const [held, setHeld] = useState(false);

  // Find the next WAITING patient (never this one — it's just been seen).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/clinic/queue');
        if (!res.ok) return;
        const parsed = ClinicQueueSchema.safeParse(await res.json());
        if (cancelled || !parsed.success) return;
        const up =
          parsed.data.entries.find(
            (e) => e.status === 'WAITING' && e.sessionId !== currentSessionId,
          ) ?? null;
        setNext(up);
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  const goHref = next
    ? `/app/patients/${next.clientId}/encounters/${next.sessionId}/live?flash=1`
    : null;

  // Countdown → auto-advance. Pauses while held or before the queue loads.
  useEffect(() => {
    if (!next || held) return;
    if (left <= 0) {
      if (goHref) router.push(goHref);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [next, held, left, goHref, router]);

  if (!loaded) return null;

  if (!next) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-[var(--color-ink-2)]">
          ✓ Queue clear — that was the last patient waiting.
        </p>
        <Link
          href="/app/clinic"
          className="text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          Back to clinic →
        </Link>
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-4 border-[var(--color-accent)] p-5">
      <span
        aria-hidden
        className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)] text-lg font-bold tabular-nums text-white"
      >
        {next.tokenNumber ?? '—'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
          Up next
        </p>
        <p className="truncate text-lg font-semibold">
          {next.patientName}
          {next.age != null && (
            <span className="font-normal text-[var(--color-ink-3)]"> · {next.age}</span>
          )}
        </p>
        <p className="text-sm text-[var(--color-ink-3)]">
          {held ? 'Held — start when you’re ready' : `Starting in ${left}s`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setHeld((h) => !h)}
          className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]"
        >
          {held ? 'Resume' : 'Hold'}
        </button>
        <Button onClick={() => goHref && router.push(goHref)}>Go now</Button>
      </div>
    </Card>
  );
}
