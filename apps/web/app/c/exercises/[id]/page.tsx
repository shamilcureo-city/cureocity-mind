'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { CbtExerciseDefinition } from '@cureocity/clinical';
import { getExerciseById } from '@cureocity/clinical';
import type { ExerciseAssignment } from '@cureocity/contracts';
import { useAuthState } from '@/lib/auth';
import { ContinuityApi } from '@/lib/continuity-api';
import { ThoughtRecordForm } from '@/lib/exercise-forms/thought-record';
import { GuidedProtocol, stepsForExercise } from '@/lib/exercise-forms/guided-protocol';
import { ExposureLogForm, FreeTextForm, MoodSliderForm } from '@/lib/exercise-forms/simple';

/**
 * Exercise execution dispatcher. Sprint 8 PR 3.
 *
 * Looks up the assignment from continuity-service, finds the matching
 * catalog entry locally (the catalog is data — bundling it client-side
 * is fine and avoids a round-trip), and dispatches to the renderer
 * that matches the exercise's responseSchema.
 *
 * On completion the response is POSTed to
 * /api/v1/me/exercises/:id/completions and we bounce back to /.
 */
export default function ExercisePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuthState();
  const [assignment, setAssignment] = useState<ExerciseAssignment | null>(null);
  const [exercise, setExercise] = useState<CbtExerciseDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cancelled = false;
    async function load(): Promise<void> {
      if (auth.status !== 'signed-in') return;
      try {
        const idToken = await auth.user.getIdToken();
        const a = await ContinuityApi.exercise(idToken, params.id);
        if (cancelled) return;
        setAssignment(a);
        setExercise(getExerciseById(a.exerciseId));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [auth, params.id]);

  async function submit(response: Record<string, unknown>, notes?: string): Promise<void> {
    if (auth.status !== 'signed-in' || !assignment) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await auth.user.getIdToken();
      await ContinuityApi.recordCompletion(idToken, assignment.id, response, notes);
      router.push('/c' as never);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
          You need to pair this device first. Go back to the QR code your therapist gave you.
        </p>
      </Shell>
    );
  }

  if (error && !assignment) {
    return (
      <Shell>
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      </Shell>
    );
  }

  if (!assignment || !exercise) {
    return (
      <Shell>
        <p className="text-sm text-[var(--color-slate-500)]">Loading exercise…</p>
      </Shell>
    );
  }

  if (assignment.status === 'COMPLETED') {
    return (
      <Shell>
        <p className="text-sm text-[var(--color-emerald-700)]">
          ✓ You&apos;ve already completed this exercise.
        </p>
        <Link href="/c" className="mt-4 inline-block text-sm underline">
          Back to home
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      {renderForExerciseSchema(exercise, { onSubmit: submit, busy })}
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
      <header className="mb-6">
        <Link href="/c" className="text-xs underline">
          ← Home
        </Link>
      </header>
      {children}
    </main>
  );
}

function renderForExerciseSchema(
  exercise: CbtExerciseDefinition,
  callbacks: {
    onSubmit: (r: Record<string, unknown>, notes?: string) => Promise<void>;
    busy: boolean;
  },
): React.ReactNode {
  const common = {
    exerciseTitle: exercise.title,
    description: exercise.description,
    onSubmit: callbacks.onSubmit,
    busy: callbacks.busy,
  };
  switch (exercise.responseSchema) {
    case 'thought_record':
      return <ThoughtRecordForm {...common} />;
    case 'binary_completed':
      return <GuidedProtocol {...common} steps={stepsForExercise(exercise.id)} />;
    case 'mood_rating_0_10':
      return <MoodSliderForm {...common} />;
    case 'exposure_log':
      return <ExposureLogForm {...common} />;
    case 'free_text':
    case 'phq9':
    case 'gad7':
    case 'whodas2':
    default:
      // Outcome-measure questionnaires (PHQ-9 / GAD-7 / WHODAS-2) land
      // in Sprint 9 with their structured item lists. Until then we
      // surface them as free-text capture so the patient can still
      // complete the assignment (and the therapist gets a usable note).
      return <FreeTextForm {...common} />;
  }
}
