'use client';

import { useCallback, useState } from 'react';
import { Button } from '../ui/Button';

/** MK4 — confirm-to-cancel card; the POST fires only on the button. */
export function CancelAppointmentCard({
  appointmentId,
  sig,
}: {
  appointmentId: string;
  sig: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const cancel = useCallback(async () => {
    setState('busy');
    try {
      const res = await fetch(
        `/api/v1/public/appointments/${appointmentId}/cancel?sig=${encodeURIComponent(sig)}`,
        { method: 'POST' },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not cancel — the link may have expired.');
      setState('done');
    } catch (e) {
      setMessage((e as Error).message);
      setState('error');
    }
  }, [appointmentId, sig]);

  return (
    <div className="w-full max-w-md rounded-3xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-8 text-center">
      {state === 'done' ? (
        <>
          <h1 className="font-serif text-2xl">Appointment cancelled</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
            The time has been released. Whenever you&rsquo;re ready, you&rsquo;re welcome to book
            again.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-serif text-2xl">Cancel this appointment?</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
            The time will open up for someone else, and your therapist will be told. This
            can&rsquo;t be undone — you&rsquo;d simply book again.
          </p>
          {message && <p className="mt-3 text-sm text-[var(--color-warn)]">{message}</p>}
          <div className="mt-6">
            <Button onClick={() => void cancel()} disabled={state === 'busy'}>
              {state === 'busy' ? 'Cancelling…' : 'Yes, cancel my appointment'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
