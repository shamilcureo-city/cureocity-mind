'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ClinicQueue, ClinicQueueEntry, ClinicQueueStatus } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

/**
 * Sprint DS7 — the zero-click clinic landing page (screens 01 / 02 / 10).
 *
 * The doctor's home is a live OPD queue, not a roster: a big next-patient
 * card that starts the consult in one tap (→ context flash → live copilot),
 * the day's token list with derived statuses, and a walk-in add. Ordering +
 * statuses come from the shared queue builder (lib/clinic-queue). See
 * docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS7.
 */
export function ClinicBoard({
  queue,
  patients,
}: {
  queue: ClinicQueue;
  patients: { id: string; name: string }[];
}) {
  const dateLabel = new Date(`${queue.date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">Today’s clinic</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Stat n={queue.waitingCount} label="waiting" tone="warn" />
          <Stat n={queue.doneCount} label="seen" tone="accent" />
        </div>
      </div>

      <NextPatientCard entry={queue.nextUp} />

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <QueueList entries={queue.entries} nextId={queue.nextUp?.sessionId ?? null} />
        <WalkInAdd patients={patients} />
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: 'warn' | 'accent' }) {
  const color = tone === 'warn' ? 'var(--color-warn)' : 'var(--color-accent)';
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xl font-semibold tabular-nums" style={{ color }}>
        {n}
      </span>
      <span className="text-[var(--color-ink-3)]">{label}</span>
    </span>
  );
}

function NextPatientCard({ entry }: { entry: ClinicQueueEntry | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!entry) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <span
          aria-hidden
          className="grid h-14 w-14 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        >
          <CheckIcon />
        </span>
        <h2 className="font-serif text-xl">Queue clear</h2>
        <p className="max-w-sm text-sm text-[var(--color-ink-2)]">
          No one is waiting. Add a walk-in below to start the next consult.
        </p>
      </Card>
    );
  }

  function start(): void {
    if (!entry) return;
    setBusy(true);
    router.push(`/app/patients/${entry.clientId}/encounters/${entry.sessionId}/live?flash=1`);
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-5 bg-gradient-to-r from-[var(--color-accent-soft)] to-white px-6 py-6">
        <span
          aria-hidden
          className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent)] text-2xl font-bold tabular-nums text-white"
        >
          {entry.tokenNumber ?? '—'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
            Next patient
          </p>
          <p className="mt-0.5 truncate text-2xl font-semibold">
            {entry.patientName}
            {entry.age != null && (
              <span className="font-normal text-[var(--color-ink-3)]"> · {entry.age}</span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">
            Token {entry.tokenNumber ?? '—'} · tap start — the note writes itself
          </p>
        </div>
        <Button onClick={start} disabled={busy} className="shrink-0 text-base">
          {busy ? 'Opening…' : '● Start consult'}
        </Button>
      </div>
    </Card>
  );
}

function QueueList({ entries, nextId }: { entries: ClinicQueueEntry[]; nextId: string | null }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--color-line-soft)] px-5 py-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-3)]">
          Queue
        </h2>
      </div>
      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
          No tokens yet today.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line-soft)]">
          {entries.map((e) => (
            <li key={e.sessionId}>
              <Link
                href={hrefFor(e)}
                className={`flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-[var(--color-surface-soft)] ${
                  e.sessionId === nextId ? 'bg-[var(--color-accent-soft)]/40' : ''
                }`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-soft)] text-sm font-bold tabular-nums text-[var(--color-ink-2)]">
                  {e.tokenNumber ?? '—'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--color-ink)]">
                    {e.patientName}
                    {e.age != null && (
                      <span className="font-normal text-[var(--color-ink-3)]"> · {e.age}</span>
                    )}
                  </span>
                </span>
                <StatusBadge status={e.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function hrefFor(e: ClinicQueueEntry): string {
  const base = `/app/patients/${e.clientId}/encounters/${e.sessionId}`;
  if (e.status === 'WAITING') return `${base}/live?flash=1`;
  if (e.status === 'IN_PROGRESS') return `${base}/live`;
  return base; // DONE / CANCELLED → the encounter workspace to review
}

const STATUS_STYLE: Record<ClinicQueueStatus, { label: string; bg: string; fg: string }> = {
  WAITING: { label: 'Waiting', bg: 'var(--color-warn-soft)', fg: 'var(--color-warn)' },
  IN_PROGRESS: { label: 'In progress', bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)' },
  DONE: { label: 'Seen', bg: 'var(--color-surface-soft)', fg: 'var(--color-ink-3)' },
  CANCELLED: { label: 'Cancelled', bg: 'var(--color-surface-soft)', fg: 'var(--color-ink-3)' },
};

function StatusBadge({ status }: { status: ClinicQueueStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function WalkInAdd({ patients }: { patients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addAndStart(): Promise<void> {
    if (!clientId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, scheduledAt: new Date().toISOString() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not add walk-in (${res.status}).`);
      }
      const created = (await res.json()) as { id: string };
      router.push(`/app/patients/${clientId}/encounters/${created.id}/live?flash=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function addToQueue(): Promise<void> {
    if (!clientId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, scheduledAt: new Date().toISOString() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not add walk-in (${res.status}).`);
      }
      setClientId('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-3)]">
        Add walk-in
      </h2>
      <p className="mt-1 text-[12px] text-[var(--color-ink-3)]">
        Assigns the next token and can start straight away.
      </p>
      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="mt-3 w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      >
        <option value="">Select a patient…</option>
        {patients.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="mt-3 flex flex-col gap-2">
        <Button onClick={addAndStart} disabled={!clientId || busy}>
          {busy ? 'Adding…' : 'Add & start now'}
        </Button>
        <button
          type="button"
          onClick={addToQueue}
          disabled={!clientId || busy}
          className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
        >
          Add to queue
        </button>
      </div>
      <Link
        href="/app/patients"
        className="mt-3 block text-center text-[12px] font-medium text-[var(--color-accent)] hover:underline"
      >
        + New patient
      </Link>
      {error && <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p>}
    </Card>
  );
}

function CheckIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
