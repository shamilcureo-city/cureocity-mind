'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { NoteDraft, TherapyNote, TherapyNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { NotePreview } from './NotePreview';
import { RiskBanner } from './RiskBanner';
import { AdvancementBanner } from './AdvancementBanner';

type SessionStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED';

interface Props {
  sessionId: string;
  sessionStatus: SessionStatus;
  initialDraft: NoteDraft | null;
  initialNote: TherapyNote | null;
  clientId: string;
}

type Phase =
  | { kind: 'awaiting-end'; status: SessionStatus }
  | { kind: 'ready-to-generate' }
  | { kind: 'generating'; draft: NoteDraft }
  | { kind: 'completed'; draft: NoteDraft }
  | { kind: 'signed'; note: TherapyNote }
  | { kind: 'failed'; draft: NoteDraft; error: string }
  | { kind: 'error'; message: string };

const POLL_MS = 2_000;

export function NotesTab({
  sessionId,
  sessionStatus,
  initialDraft,
  initialNote,
  clientId,
}: Props) {
  const [phase, setPhase] = useState<Phase>(() => derivePhase(sessionStatus, initialDraft, initialNote));
  const [generating, setGenerating] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const pollOnce = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note-draft`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        // End route hasn't created the row yet, or the session was never
        // ended — keep polling for a few ticks.
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Poll failed (${res.status})`);
      }
      const draft = (await res.json()) as NoteDraft;
      if (draft.status === 'COMPLETED' && draft.content) {
        setPhase({ kind: 'completed', draft });
        stopPolling();
      } else if (draft.status === 'FAILED') {
        setPhase({ kind: 'failed', draft, error: draft.errorMessage ?? 'Note generation failed.' });
        stopPolling();
      } else {
        setPhase({ kind: 'generating', draft });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
      stopPolling();
    }
  }, [sessionId, stopPolling]);

  // Manage the polling loop based on phase.
  useEffect(() => {
    if (phase.kind !== 'generating' && phase.kind !== 'awaiting-end') {
      stopPolling();
      return;
    }
    const tick = async (): Promise<void> => {
      await pollOnce();
      pollTimer.current = setTimeout(() => void tick(), POLL_MS);
    };
    pollTimer.current = setTimeout(() => void tick(), POLL_MS);
    return stopPolling;
  }, [phase.kind, pollOnce, stopPolling]);

  const triggerGeneration = useCallback(async (): Promise<void> => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/generate-note`, {
        method: 'POST',
      });
      if (!res.ok && res.status !== 500) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Generation failed (${res.status})`);
      }
      // The route returns the orchestrator result (COMPLETED or FAILED).
      // Either way, switch to polling so the UI reads the persisted state.
      await pollOnce();
      if (phase.kind === 'ready-to-generate') {
        setPhase({
          kind: 'generating',
          draft: {
            id: 'placeholder',
            sessionId,
            status: 'IN_PROGRESS',
            transcript: null,
            speakerSegments: null,
            affectFeatures: null,
            content: null,
            riskSeverity: null,
            totalCostInr: '0',
            errorMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }, [sessionId, pollOnce, phase.kind]);

  // ----- Render -----

  if (phase.kind === 'awaiting-end') {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-xl">Session is still {phase.status.toLowerCase()}.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          End the recording from the Record page to release the audio for note generation.
        </p>
        <div className="mt-4">
          <Link
            href="/app"
            className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            Back to Record
          </Link>
        </div>
      </Card>
    );
  }

  if (phase.kind === 'ready-to-generate') {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-xl">Recording ended. Ready to draft the note.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          Pass 1 transcribes + diarizes; Pass 2 writes the clinical draft. Usually 10–30 seconds.
          You can edit before signing.
        </p>
        <div className="mt-5">
          <Button onClick={triggerGeneration} disabled={generating}>
            {generating ? 'Starting…' : 'Generate note'}
          </Button>
        </div>
      </Card>
    );
  }

  if (phase.kind === 'generating') {
    return <GeneratingState draft={phase.draft} />;
  }

  if (phase.kind === 'failed') {
    return (
      <Card className="p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-serif text-xl text-[var(--color-warn)]">Note generation failed.</p>
            <p className="mt-2 max-w-md text-sm text-[var(--color-ink-2)]">{phase.error}</p>
            {phase.error.toLowerCase().includes('cost') && (
              <p className="mt-3 max-w-md rounded-xl bg-[var(--color-warn-soft)] p-3 text-xs text-[var(--color-warn)]">
                The cost circuit tripped — this session would have exceeded the configured per-
                session or per-therapist monthly budget. Override by raising the cap in env vars
                <code className="mx-1 rounded bg-white/60 px-1 font-mono">
                  COST_CAP_PER_SESSION_INR
                </code>
                or
                <code className="mx-1 rounded bg-white/60 px-1 font-mono">
                  COST_CAP_PER_THERAPIST_MONTHLY_INR
                </code>
                .
              </p>
            )}
          </div>
          <Button onClick={triggerGeneration} disabled={generating}>
            {generating ? 'Retrying…' : 'Retry generation'}
          </Button>
        </div>
      </Card>
    );
  }

  if (phase.kind === 'error') {
    return (
      <Card className="p-10">
        <p className="font-serif text-xl">Could not load the draft.</p>
        <p className="mt-2 text-sm text-[var(--color-warn)]">{phase.message}</p>
        <Button
          variant="secondary"
          onClick={() => void pollOnce()}
          className="mt-4"
        >
          Try again
        </Button>
      </Card>
    );
  }

  if (phase.kind === 'signed') {
    const note = phase.note;
    return (
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-7">
          <AdvancementBanner clientId={clientId} />
          <RiskBanner riskFlags={note.content.riskFlags} />
          <NotePreview
            note={note.content}
            signedAt={note.signedAt}
            signedBy={note.signedBy}
          />
          <div className="mt-4 flex justify-end">
            <a
              href={`/api/v1/sessions/${sessionId}/note/pdf`}
              download
              className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              Download PDF
            </a>
          </div>
          <NoteFooter
            costInr="—"
            chunkCount={0}
            transcriptChars={0}
            region="signed"
          />
        </Card>
        <ModifyPanel disabled />
      </div>
    );
  }

  // completed
  const note = phase.draft.content as TherapyNoteV1;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card className="p-7">
        <RiskBanner riskFlags={note.riskFlags} />
        <NotePreview note={note} />
        <NoteFooter
          costInr={phase.draft.totalCostInr}
          chunkCount={phase.draft.speakerSegments?.length ?? 0}
          transcriptChars={phase.draft.transcript?.length ?? 0}
          region={process.env.NEXT_PUBLIC_LLM_BACKEND ?? 'mock'}
        />
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--color-line-soft)] pt-5">
          <Button disabled>Sign off (Sprint 4)</Button>
          <Button variant="secondary" onClick={triggerGeneration} disabled={generating}>
            Re-generate
          </Button>
        </div>
      </Card>
      <ModifyPanel disabled />
    </div>
  );
}

function GeneratingState({ draft }: { draft: NoteDraft }) {
  const steps = [
    { key: 'PENDING', label: 'Setting up the run' },
    { key: 'IN_PROGRESS', label: 'Transcribing + drafting' },
    { key: 'COMPLETED', label: 'Done' },
  ] as const;
  const idx = steps.findIndex((s) => s.key === draft.status);
  return (
    <Card className="p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-serif text-xl">
            <span className="inline-block animate-pulse">●</span> Generating note…
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Pass 1 (transcribe + diarize) then Pass 2 (clinical draft). Polling every 2 seconds.
          </p>
        </div>
        <Badge tone="warn">{draft.status.replace(/_/g, ' ').toLowerCase()}</Badge>
      </div>
      <ol className="mt-6 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li
              key={s.key}
              className={`rounded-xl border px-4 py-3 text-sm ${
                done
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : active
                    ? 'border-[var(--color-warn)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                    : 'border-[var(--color-line)] bg-white text-[var(--color-ink-3)]'
              }`}
            >
              <span className="text-xs font-medium uppercase tracking-wider">Step {i + 1}</span>
              <span className="mt-1 block">{s.label}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function NoteFooter({
  costInr,
  chunkCount,
  transcriptChars,
  region,
}: {
  costInr: string;
  chunkCount: number;
  transcriptChars: number;
  region: string;
}) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-[var(--color-line-soft)] pt-5 text-xs text-[var(--color-ink-3)] sm:grid-cols-4">
      <Stat label="Cost" value={costInr === '—' ? '—' : `₹${costInr}`} />
      <Stat label="Segments" value={String(chunkCount)} />
      <Stat label="Transcript" value={`${transcriptChars} chars`} />
      <Stat label="Backend" value={region} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 font-mono text-[13px] text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

function ModifyPanel({ disabled }: { disabled: boolean }) {
  return (
    <Card className="flex h-full flex-col p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
        AI assistant
      </p>
      <h3 className="mt-1 font-serif text-2xl">Modify your note</h3>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        Tell the scribe what to change — “make it more concise”, “rewrite the plan as bullets”,
        “remove client names”. Ships in Sprint 4.
      </p>

      <div className="mt-5 grid gap-2">
        {['Change to paragraph format', 'Remove all names', 'Make more concise', 'Expand plan'].map((q) => (
          <button
            key={q}
            type="button"
            disabled
            className="flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-white px-4 py-2.5 text-left text-sm text-[var(--color-ink-3)] opacity-70"
          >
            {q}
            <span className="text-xs text-[var(--color-ink-3)]">→</span>
          </button>
        ))}
      </div>

      <div className="mt-auto pt-6">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-sm text-[var(--color-ink-3)]">
          <p>How would you like to modify your note?</p>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-white p-2">
            <input
              type="text"
              placeholder="Enter modifications here"
              disabled
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-ink-3)]"
            />
            <button
              type="button"
              disabled
              aria-label="Send"
              className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] text-white opacity-60"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
      {disabled && (
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          Sprint 4 wires this panel + “Sign off” to the real LLM edit pipeline.
        </p>
      )}
    </Card>
  );
}

function derivePhase(
  sessionStatus: SessionStatus,
  draft: NoteDraft | null,
  note: TherapyNote | null,
): Phase {
  if (note) return { kind: 'signed', note };
  if (draft?.status === 'COMPLETED' && draft.content) return { kind: 'completed', draft };
  if (draft?.status === 'FAILED') {
    return { kind: 'failed', draft, error: draft.errorMessage ?? 'Note generation failed.' };
  }
  if (draft && (draft.status === 'PENDING' || draft.status === 'IN_PROGRESS')) {
    return { kind: 'generating', draft };
  }
  if (sessionStatus === 'COMPLETED') return { kind: 'ready-to-generate' };
  return { kind: 'awaiting-end', status: sessionStatus };
}
