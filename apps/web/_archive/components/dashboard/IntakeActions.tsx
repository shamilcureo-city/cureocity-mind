'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';

export function IntakeActions({ intakeId }: { intakeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(status: 'MATCHED' | 'REVIEWED' | 'CLOSED', assignToSelf = false): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`/api/v1/intake/${intakeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, assignToSelf }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => void patch('MATCHED', true)}>
        Match to me
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => void patch('REVIEWED')}
      >
        Mark reviewed
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => void patch('CLOSED')}>
        Close
      </Button>
      {error && <span className="text-xs text-[var(--color-warn)]">{error}</span>}
    </div>
  );
}
