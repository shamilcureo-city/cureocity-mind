'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { JournalEntry } from '@cureocity/contracts';
import { useAuthState } from '@/lib/auth';
import { ContinuityApi } from '@/lib/continuity-api';

/**
 * Journal entry capture + history.
 *
 * Share/private toggle (Sprint 8 PR 2): entries default to private —
 * not visible in the therapist briefing. Toggling "share with my
 * therapist" before submitting allows the briefing dossier to include
 * the entry. Past entries' share state is shown but not editable in
 * V1; editing share state retroactively lands in Sprint 9 alongside
 * the DSR endpoints.
 */
export default function JournalPage() {
  const auth = useAuthState();
  const [content, setContent] = useState<string>('');
  const [share, setShare] = useState<boolean>(false);
  const [list, setList] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cancelled = false;
    async function load(): Promise<void> {
      if (auth.status !== 'signed-in') return;
      try {
        const idToken = await auth.user.getIdToken();
        const rows = await ContinuityApi.listJournals(idToken, 50);
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
    if (content.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await auth.user.getIdToken();
      const created = await ContinuityApi.createJournal(idToken, {
        content: content.trim(),
        sharedWithTherapist: share,
      });
      setList((prev) => [created, ...prev]);
      setContent('');
      setShare(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="mb-6">
        <Link href="/c" className="text-xs underline">
          ← Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-navy-700)]">Journal</h1>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">
          Write a quick reflection. Entries are private by default.
        </p>
      </header>

      <form
        onSubmit={submit}
        className="mb-8 rounded-2xl border border-[var(--color-slate-200)] bg-white p-5"
      >
        <label className="block text-sm">
          Today
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            maxLength={20_000}
            placeholder="What stood out today? What did you notice?"
            className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
          />
        </label>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Share with my therapist</span>
            <span className="block text-xs text-[var(--color-slate-500)]">
              Shared entries appear in your therapist&apos;s briefing before your next session.
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={busy || content.trim().length === 0}
          className="mt-4 w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save entry'}
        </button>
      </form>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          History
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-[var(--color-slate-500)]">No entries yet.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((j) => (
              <li
                key={j.id}
                className="rounded-md border border-[var(--color-slate-200)] bg-white p-4"
              >
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs text-[var(--color-slate-500)]">
                    {new Date(j.recordedAt).toLocaleString('en-IN')}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      j.sharedWithTherapist
                        ? 'bg-[var(--color-emerald-100)] text-[var(--color-emerald-700)]'
                        : 'bg-[var(--color-slate-200)] text-[var(--color-slate-500)]'
                    }`}
                  >
                    {j.sharedWithTherapist ? 'Shared' : 'Private'}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{j.content}</p>
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
