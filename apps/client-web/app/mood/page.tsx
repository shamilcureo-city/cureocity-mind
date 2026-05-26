'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { MoodLog } from '@cureocity/contracts';
import { useAuthState } from '@/lib/auth';
import { ContinuityApi } from '@/lib/continuity-api';

/**
 * Mood log entry. 0..10 rating slider + optional note. After submit,
 * appends to the in-page list optimistically while the server response
 * resolves.
 *
 * Per the PRD this is the daily check-in surface; intentionally one
 * tap to open, one swipe to choose a value, one button to send.
 */
export default function MoodPage() {
  const auth = useAuthState();
  const [rating, setRating] = useState<number>(5);
  const [notes, setNotes] = useState<string>('');
  const [list, setList] = useState<MoodLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cancelled = false;
    async function load(): Promise<void> {
      if (auth.status !== 'signed-in') return;
      try {
        const idToken = await auth.user.getIdToken();
        const rows = await ContinuityApi.listMoods(idToken, 30);
        if (!cancelled) setList(rows);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (auth.status !== 'signed-in') return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await auth.user.getIdToken();
      const created = await ContinuityApi.logMood(idToken, {
        rating,
        ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
      });
      setList((prev) => [created, ...prev]);
      setNotes('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="mb-6">
        <Link href="/" className="text-xs underline">
          ← Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-navy-700)]">Mood check-in</h1>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">
          How are you feeling right now? 0 is very low, 10 is great.
        </p>
      </header>

      <form
        onSubmit={submit}
        className="mb-8 rounded-2xl border border-[var(--color-slate-200)] bg-white p-5"
      >
        <label className="block">
          <span className="flex items-baseline justify-between text-sm">
            <span>Rating</span>
            <span className="text-2xl font-semibold tabular-nums">{rating}</span>
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
            className="mt-2 w-full"
          />
          <span className="mt-1 flex justify-between text-xs text-[var(--color-slate-500)]">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </span>
        </label>

        <label className="mt-4 block text-sm">
          Note (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Log mood'}
        </button>
      </form>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Recent
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-[var(--color-slate-500)]">No mood entries yet.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-[var(--color-slate-200)] bg-white p-3"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold tabular-nums">{m.rating}/10</span>
                  <span className="text-xs text-[var(--color-slate-500)]">
                    {new Date(m.recordedAt).toLocaleString('en-IN')}
                  </span>
                </div>
                {m.notes && <p className="mt-1 text-sm">{m.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </main>
  );
}
