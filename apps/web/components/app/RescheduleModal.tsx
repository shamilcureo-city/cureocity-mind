'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Label, Textarea, FieldError } from '../ui/Field';
import { useModalA11y } from '@/lib/use-modal-a11y';

interface Props {
  open: boolean;
  sessionId: string;
  clientName: string;
  /** ISO of the current slot — used to seed the date/time inputs. */
  currentScheduledAt: string;
  onClose: () => void;
}

/**
 * Sprint 45 — move a scheduled session to a new time.
 *
 * Posts to /sessions/[id]/reschedule, which marks this session
 * RESCHEDULED and creates a fresh SCHEDULED session at the new
 * time (the audit trail keeps both). Reason is optional but
 * encouraged — it lands in the audit metadata for later context.
 */
export function RescheduleModal({
  open,
  sessionId,
  clientName,
  currentScheduledAt,
  onClose,
}: Props) {
  const router = useRouter();
  const seed = splitForInputs(currentScheduledAt);
  const [date, setDate] = useState(seed.date);
  const [time, setTime] = useState(seed.time);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, dialogRef, onClose);

  if (!open) return null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const newScheduledAt = combineToIso(date, time);
      if (!newScheduledAt) throw new Error('Pick a valid date and time.');
      const res = await fetch(`/api/v1/sessions/${sessionId}/reschedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newScheduledAt,
          ...(reason.trim() && { reason: reason.trim() }),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-title"
    >
      <Card className="w-full max-w-md p-6">
        <header className="mb-4">
          <h2 id="reschedule-title" className="font-serif text-xl">
            Reschedule {clientName}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-ink-2)]">
            The current slot becomes <strong>RESCHEDULED</strong> and a new SCHEDULED session opens
            at the new time. Both stay on the record.
          </p>
        </header>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rs-date">New date</Label>
              <Input
                id="rs-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="rs-time">New time (IST)</Label>
              <Input
                id="rs-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rs-reason" hint="optional">
              Reason
            </Label>
            <Textarea
              id="rs-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client requested — exam week."
            />
          </div>
          <FieldError message={error} />
          <div className="flex justify-end gap-2 border-t border-[var(--color-line-soft)] pt-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Rescheduling…' : 'Reschedule'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IST-aware date/time helpers.
//
// `<input type="date">` and `<input type="time">` carry naive values
// with no timezone. The therapist's mental model is IST, so we treat
// the typed values as IST clock-time and convert to a UTC ISO string
// for the API. The reverse seed splits an ISO back into IST date+time
// for editing.
// ---------------------------------------------------------------------------

const IST_OFFSET_MIN = 5 * 60 + 30;

function splitForInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  // Shift to IST clock and read the UTC parts so we get the IST calendar.
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  const date = ist.toISOString().slice(0, 10);
  const time = ist.toISOString().slice(11, 16);
  return { date, time };
}

function combineToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map((p) => Number.parseInt(p, 10));
  const [hh, mm] = time.split(':').map((p) => Number.parseInt(p, 10));
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  // Wall-clock IST → UTC by subtracting the offset from the IST instant.
  const utcMs = Date.UTC(y, (m ?? 1) - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000;
  return new Date(utcMs).toISOString();
}
