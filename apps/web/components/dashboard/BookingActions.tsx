'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';

export function BookingActions({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(status: 'ACCEPTED' | 'DECLINED'): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`/api/v1/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => void patch('ACCEPTED')}>
        Accept
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => void patch('DECLINED')}
      >
        Decline
      </Button>
      {error && <span className="text-xs text-[var(--color-warn)]">{error}</span>}
    </div>
  );
}
