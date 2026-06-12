'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Label, Select, FieldError } from '../ui/Field';

interface ClientOption {
  id: string;
  fullName: string;
  preferredModality: string | null;
}

interface Props {
  clients: ClientOption[];
}

/**
 * Sprint 45 — schedule a future session straight from the Today
 * screen. Opens an inline modal; on submit posts to the existing
 * /api/v1/sessions route with a future scheduledAt (the same route
 * Record uses for walk-ins, just with a non-now time). The
 * session-defaults cascade still picks modality + kind.
 *
 * Booking flow without a new entity — Session.scheduledAt is the
 * calendar. The future Booking model (public lead inbox) lives in
 * Sprint 49's scope.
 */
export function ScheduleSessionPanel({ clients }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Schedule session</Button>
      {open && (
        <ScheduleModal
          clients={clients}
          onClose={() => setOpen(false)}
          onScheduled={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ScheduleModal({
  clients,
  onClose,
  onScheduled,
}: {
  clients: ClientOption[];
  onClose: () => void;
  onScheduled: () => void;
}) {
  const tomorrow = useMemo(() => seedTomorrow(), []);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(tomorrow.date);
  const [time, setTime] = useState('10:00');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 30);
    return clients.filter((c) => c.fullName.toLowerCase().includes(q)).slice(0, 30);
  }, [clients, query]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!clientId) throw new Error('Pick a client.');
      const scheduledAt = combineToIso(date, time);
      if (!scheduledAt) throw new Error('Pick a valid date and time.');
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, scheduledAt }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      onScheduled();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-title"
    >
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="schedule-title" className="font-serif text-xl">
            Schedule session
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            cancel
          </button>
        </header>
        {clients.length === 0 ? (
          <p className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-2)]">
            No active clients yet. Add one from <strong>Clients</strong> first.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="sched-search" hint="search by name">
                Client
              </Label>
              <Input
                id="sched-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
              />
              <Select
                className="mt-2"
                aria-label="Pick a client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
              >
                {filtered.length === 0 ? (
                  <option value="">No matches</option>
                ) : (
                  filtered.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                      {c.preferredModality ? ` · ${c.preferredModality}` : ''}
                    </option>
                  ))
                )}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sched-date">Date</Label>
                <Input
                  id="sched-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="sched-time">Time (IST)</Label>
                <Input
                  id="sched-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </div>
            </div>
            <FieldError message={error} />
            <div className="flex justify-end gap-2 border-t border-[var(--color-line-soft)] pt-4">
              <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Scheduling…' : 'Schedule'}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

// IST helpers — naive date/time inputs are treated as IST clock-time.
const IST_OFFSET_MIN = 5 * 60 + 30;

function seedTomorrow(): { date: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  ist.setUTCDate(ist.getUTCDate() + 1);
  return { date: ist.toISOString().slice(0, 10) };
}

function combineToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map((p) => Number.parseInt(p, 10));
  const [hh, mm] = time.split(':').map((p) => Number.parseInt(p, 10));
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  const utcMs = Date.UTC(y, (m ?? 1) - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000;
  return new Date(utcMs).toISOString();
}
