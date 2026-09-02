'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Outcome = 'DONE' | 'PARTLY' | 'NOT_YET';

export function HomeworkDoneButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reflection, setReflection] = useState('');

  async function submit(outcome: Outcome) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/p/${token}/homework`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outcome,
          ...(reflection.trim() && { reflection: reflection.trim() }),
        }),
      });
      if (!res.ok) {
        setError('We could not save that response. Please try again.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-xs text-[var(--color-ink-2)]">
        Barrier or reflection (optional)
        <textarea
          value={reflection}
          onChange={(event) => setReflection(event.target.value)}
          maxLength={2000}
          rows={2}
          className="mt-1 w-full rounded-xl border border-[var(--color-line-soft)] bg-white p-3 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2" aria-label="How did the homework go?">
        {(
          [
            ['DONE', 'Done'],
            ['PARTLY', 'Partly'],
            ['NOT_YET', 'Not yet'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => void submit(value)}
            disabled={busy}
            className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
    </div>
  );
}
