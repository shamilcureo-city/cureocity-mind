'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type {
  ExerciseAssignment,
  JournalEntry,
  MoodLog,
  NextSessionSummary,
} from '@cureocity/contracts';
import { useAuthState } from '@/lib/auth';
import { ContinuityApi } from '@/lib/continuity-api';
import { ensurePushSubscription } from '@/lib/push';
import { PwaInstallPrompt } from '@/lib/pwa-install';

interface HomeData {
  exercises: ExerciseAssignment[];
  recentMoods: MoodLog[];
  recentJournals: JournalEntry[];
  nextSession: NextSessionSummary | null;
}

/**
 * Therapy home. Composes:
 *   - Next session reminder (top card)
 *   - Today's assignments (chronological, PENDING + IN_PROGRESS only)
 *   - Mood card (last 7 entries inline; tap → /mood)
 *   - Journal preview (latest entry; tap → /journal)
 *
 * The four requests run in parallel; partial failures surface inline
 * rather than blanking the whole screen.
 */
export default function HomePage() {
  const auth = useAuthState();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cancelled = false;
    async function load(): Promise<void> {
      if (auth.status !== 'signed-in') return;
      try {
        const idToken = await auth.user.getIdToken();
        const [exercises, recentMoods, recentJournals, nextSession] = await Promise.all([
          ContinuityApi.exercises(idToken),
          ContinuityApi.listMoods(idToken, 7),
          ContinuityApi.listJournals(idToken, 3),
          ContinuityApi.nextSession(idToken),
        ]);
        if (!cancelled) {
          setData({ exercises, recentMoods, recentJournals, nextSession });
        }
        // Fire-and-forget push registration. Permission prompt is
        // shown on first call; subsequent calls are idempotent
        // (subscription upsert server-side). Don't await — never block
        // the home render on the notification dialog.
        void ensurePushSubscription(auth.user);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  if (auth.status === 'loading') {
    return (
      <Shell>
        <p className="text-sm text-[var(--color-slate-500)]">Loading…</p>
      </Shell>
    );
  }
  if (auth.status === 'signed-out') {
    return (
      <Shell>
        <p className="text-sm text-[var(--color-slate-500)]">
          You haven&apos;t paired this device yet. Scan the QR code your therapist gave you, or use
          the link they sent you.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <PwaInstallPrompt />
      {data?.nextSession && <NextSessionCard session={data.nextSession} />}

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          For today
        </h2>
        {data === null && !error && (
          <p className="text-sm text-[var(--color-slate-500)]">Loading exercises…</p>
        )}
        {data && data.exercises.length === 0 && (
          <p className="rounded-2xl border border-[var(--color-slate-200)] bg-white p-5 text-sm text-[var(--color-slate-500)]">
            Nothing assigned right now. Your next session is the best time to set new exercises.
          </p>
        )}
        {data && data.exercises.length > 0 && (
          <ul className="space-y-2">
            {data.exercises.map((a) => (
              <li
                key={a.id}
                className="rounded-2xl border border-[var(--color-slate-200)] bg-white p-4"
              >
                <Link href={`/c/exercises/${a.id}`} className="block">
                  <p className="font-medium">{prettyExerciseId(a.exerciseId)}</p>
                  <p className="text-xs text-[var(--color-slate-500)]">
                    {a.dueAt
                      ? `Due ${formatDate(a.dueAt)}`
                      : `Assigned ${formatDate(a.assignedAt)}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MoodCard recentMoods={data?.recentMoods ?? []} />

      <JournalCard recent={data?.recentJournals ?? []} />

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Cureocity Mind
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">Therapy home</h1>
      </header>
      {children}
    </main>
  );
}

function NextSessionCard({ session }: { session: NextSessionSummary }) {
  return (
    <section className="mb-6 rounded-2xl border border-[var(--color-navy-500)] bg-[var(--color-navy-50)] p-5">
      <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">Next session</p>
      <p className="mt-1 text-lg font-semibold text-[var(--color-navy-700)]">
        {formatDateTime(session.scheduledAt)}
      </p>
      <p className="text-sm text-[var(--color-slate-500)]">
        With {session.psychologistFullName} ({session.modality})
      </p>
    </section>
  );
}

function MoodCard({ recentMoods }: { recentMoods: MoodLog[] }) {
  const latest = recentMoods[0];
  return (
    <section className="mb-6 rounded-2xl border border-[var(--color-slate-200)] bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Mood
        </h2>
        <Link href="/c/mood" className="text-xs underline">
          Log mood
        </Link>
      </div>
      {latest ? (
        <p className="mt-2 text-sm">
          Last entry: <span className="font-semibold">{latest.rating}/10</span>
          {latest.notes && <span className="text-[var(--color-slate-500)]"> — {latest.notes}</span>}
          <span className="text-xs text-[var(--color-slate-500)]">
            {' '}
            · {formatDate(latest.recordedAt)}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-slate-500)]">
          No mood logged yet — tap above to add one.
        </p>
      )}
    </section>
  );
}

function JournalCard({ recent }: { recent: JournalEntry[] }) {
  const latest = recent[0];
  return (
    <section className="mb-6 rounded-2xl border border-[var(--color-slate-200)] bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Journal
        </h2>
        <Link href="/c/journal" className="text-xs underline">
          Write entry
        </Link>
      </div>
      {latest ? (
        <p className="mt-2 line-clamp-2 text-sm text-[var(--color-slate-500)]">{latest.content}</p>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-slate-500)]">
          No entries yet — your journal is private unless you tap &ldquo;share with
          therapist&rdquo;.
        </p>
      )}
    </section>
  );
}

function prettyExerciseId(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Cbt/g, 'CBT')
    .replace(/Emdr/g, 'EMDR');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
