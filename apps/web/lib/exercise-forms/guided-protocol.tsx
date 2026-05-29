'use client';

import { useState } from 'react';
import type { RendererProps } from './types';

/**
 * Guided multi-step protocol — the "timed-protocol archetype" the
 * plan calls for. Used by:
 *   - emdr_safe_place_installation  (Sprint 8 PR 3 cornerstone)
 *   - emdr_resource_team
 *   - emdr_container_exercise
 *   - emdr_grounding_5_4_3_2_1
 *   - any catalog entry with responseSchema === 'binary_completed'
 *
 * Steps are passed in by the dispatcher based on exercise id. Each
 * step shows instructions; the patient taps "Next" when ready. The
 * final step records the response (notes optional) and posts.
 *
 * Response payload:
 *   { completed: true, stepCount, notes? }
 */
export interface ProtocolStep {
  /** Heading shown at the top of the step card. */
  title: string;
  /** Plain paragraph(s) of instruction. Newlines preserved. */
  body: string;
  /** Optional duration in seconds — renders a timer + auto-advance hint. */
  durationSec?: number;
}

export function GuidedProtocol({
  exerciseTitle,
  description,
  onSubmit,
  busy,
  steps,
}: RendererProps & { steps: ProtocolStep[] }) {
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState('');
  const total = steps.length;
  const step = steps[index];
  const lastStep = index === total - 1;

  if (!step) return null;

  function finish(): void {
    void onSubmit({ completed: true, stepCount: total }, notes.trim() || undefined);
  }

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-[var(--color-navy-700)]">{exerciseTitle}</h2>
        <p className="mt-1 text-sm text-[var(--color-slate-500)]">{description}</p>
      </header>

      <div className="rounded-2xl border border-[var(--color-slate-200)] bg-white p-5">
        <p className="mb-1 text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Step {index + 1} of {total}
          {step.durationSec ? ` · about ${Math.round(step.durationSec / 60)} min` : ''}
        </p>
        <h3 className="text-base font-semibold">{step.title}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{step.body}</p>
      </div>

      {lastStep && (
        <label className="block text-sm">
          <span className="font-medium">Anything you want to remember?</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Optional — your safe place, the cue word, anything that came up."
            className="mt-1 w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none"
          />
        </label>
      )}

      <div className="flex gap-3">
        {index > 0 && (
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="flex-1 rounded-md border border-[var(--color-slate-200)] bg-white px-4 py-3 text-sm font-medium"
          >
            Back
          </button>
        )}
        {!lastStep && (
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            className="flex-1 rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white"
          >
            Next
          </button>
        )}
        {lastStep && (
          <button
            type="button"
            onClick={finish}
            disabled={busy}
            className="flex-1 rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Mark complete'}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Catalog of guided-protocol step sequences, keyed by exerciseId.
 * Hand-curated; the catalog metadata holds the title + description, so
 * here we only provide the step bodies. Falls back to a single-step
 * "mark complete" sequence when no entry exists.
 */
export const GUIDED_PROTOCOLS: Record<string, ProtocolStep[]> = {
  emdr_safe_place_installation: [
    {
      title: 'Choose a place',
      body: 'Bring to mind somewhere real or imagined where you feel completely safe and calm. It could be a beach at dawn, a quiet corner of your home, a forest path. Settle on one place before moving on.',
      durationSec: 120,
    },
    {
      title: 'Notice the details',
      body: "Look around your safe place. What do you see — colours, light, shapes? What do you hear? What's the temperature on your skin? Any scent in the air? Spend a minute really being there.",
      durationSec: 180,
    },
    {
      title: 'Find your cue word',
      body: 'Pick one word that captures the feeling of being there — "calm", "ocean", "home", whatever fits. This is your cue word; you can use it any time to reconnect with this feeling.',
      durationSec: 60,
    },
    {
      title: 'Bilateral installation',
      body: 'With the image vivid and the cue word in mind, slowly alternate tapping your left and right knee (or shoulders, crossed-arms-butterfly style) for about 30 seconds. Then pause and notice if the feeling deepens.',
      durationSec: 60,
    },
    {
      title: 'Close',
      body: "When you're ready, open your eyes if they were closed. You can return to your safe place whenever you need — just use your cue word and the feeling will come back more quickly each time.",
    },
  ],
  emdr_grounding_5_4_3_2_1: [
    {
      title: '5 things you can see',
      body: 'Look around right now. Name 5 things you can see. Say them aloud or in your head — anything counts.',
      durationSec: 60,
    },
    {
      title: '4 things you can touch',
      body: 'Notice 4 things you can feel — your feet on the floor, the chair under you, the texture of your clothes, the air on your skin.',
      durationSec: 60,
    },
    {
      title: '3 things you can hear',
      body: 'Listen for 3 sounds. They can be close (your breathing) or far (traffic, birds, a fan).',
      durationSec: 60,
    },
    {
      title: '2 things you can smell',
      body: 'Notice 2 scents. If there are none obvious, bring to mind two scents you like.',
      durationSec: 30,
    },
    {
      title: '1 thing you can taste',
      body: 'Notice the taste in your mouth, or sip water and notice that. Take a slow breath.',
      durationSec: 30,
    },
  ],
  emdr_container_exercise: [
    {
      title: 'Picture a container',
      body: 'Imagine a sturdy container — a chest, a vault, a jar with a tight lid. Picture it clearly: its size, material, where it sits.',
      durationSec: 60,
    },
    {
      title: 'Put away what is too heavy',
      body: "Bring to mind anything that's feeling too heavy to carry right now — a worry, a memory, a what-if. See yourself placing it inside the container.",
      durationSec: 120,
    },
    {
      title: 'Close and secure',
      body: "Close the lid. Lock or seal it however feels right. The contents are not gone — they're safely stored, and you can return to them with your therapist when the time is right.",
      durationSec: 60,
    },
  ],
};

export function stepsForExercise(exerciseId: string): ProtocolStep[] {
  return (
    GUIDED_PROTOCOLS[exerciseId] ?? [
      {
        title: 'Complete the exercise',
        body: "Follow the instructions your therapist gave you, then tap Mark complete when you're done.",
      },
    ]
  );
}
