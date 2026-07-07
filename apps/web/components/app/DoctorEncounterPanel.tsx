'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MedicalEncounterNoteV1Schema, type MedicalEncounterNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LiveRecorder } from './LiveRecorder';
import { FileUploadPanel } from './FileUploadPanel';
import { ReviewAndSign } from './ReviewAndSign';

/**
 * Sprint DV3 — the doctor encounter workspace body. Drives the record →
 * note loop on the existing batch pipeline:
 *   consent → start → record → end → generate-note → poll → render.
 * Reuses LiveRecorder (audio capture) + the medical note from Pass 2's
 * MEDICAL arm. Sign + after-visit summary land in the next chunk.
 * See docs/DOCTOR_VERTICAL.md.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'idle' } // no draft yet, ready to record
  | { kind: 'starting' } // consent + start in flight
  | { kind: 'recording' }
  | { kind: 'generating' } // draft PENDING / IN_PROGRESS, polling
  | { kind: 'done'; note: MedicalEncounterNoteV1 }
  | { kind: 'failed'; message: string };

// DPDP scopes the scribe pipeline needs; the patient granted them at
// creation, this re-confirms them for the encounter (the /start route
// refuses without a session consent snapshot).
const CONSENT_SCOPES = ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'];

export function DoctorEncounterPanel({
  sessionId,
  clientId,
  clientName,
  sessionStatus,
  mode = 'dictate',
}: {
  sessionId: string;
  clientId: string;
  clientName: string;
  sessionStatus: string;
  /** DS11.7 — the batch capture pipeline: dictate (mic) or upload a file. */
  mode?: 'dictate' | 'upload';
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(
    sessionStatus === 'IN_PROGRESS' ? { kind: 'recording' } : { kind: 'loading' },
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reviewHref = `/app/patients/${clientId}/encounters/${sessionId}`;

  const fetchDraft = useCallback(async () => {
    const res = await fetch(`/api/v1/sessions/${sessionId}/note-draft`);
    if (res.status === 404) {
      setState({ kind: 'idle' });
      return;
    }
    if (!res.ok) {
      setState({ kind: 'failed', message: `Could not load the note (${res.status}).` });
      return;
    }
    const draft = (await res.json()) as {
      status: string;
      content: unknown;
      errorMessage: string | null;
    };
    if (draft.status === 'COMPLETED') {
      const parsed = MedicalEncounterNoteV1Schema.safeParse(draft.content);
      setState(
        parsed.success
          ? { kind: 'done', note: parsed.data }
          : { kind: 'failed', message: 'The note could not be read.' },
      );
    } else if (draft.status === 'FAILED') {
      setState({ kind: 'failed', message: draft.errorMessage ?? 'Note generation failed.' });
    } else {
      setState({ kind: 'generating' });
    }
  }, [sessionId]);

  // Initial load — unless we mounted straight into an in-progress recording.
  useEffect(() => {
    if (sessionStatus !== 'IN_PROGRESS') void fetchDraft();
  }, [fetchDraft, sessionStatus]);

  // Poll while the note is being generated.
  useEffect(() => {
    if (state.kind !== 'generating') return;
    pollRef.current = setInterval(() => void fetchDraft(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state.kind, fetchDraft]);

  async function beginRecording(): Promise<void> {
    setState({ kind: 'starting' });
    try {
      const consent = await fetch(`/api/v1/sessions/${sessionId}/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes: CONSENT_SCOPES, scriptVersion: 'v1.0' }),
      });
      if (!consent.ok) throw new Error(await errorOf(consent, 'Could not record consent'));
      const started = await fetch(`/api/v1/sessions/${sessionId}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ captureMode: mode === 'upload' ? 'UPLOAD' : 'DICTATE' }),
      });
      if (!started.ok) throw new Error(await errorOf(started, 'Could not start the encounter'));
      setState({ kind: 'recording' });
    } catch (e) {
      setState({ kind: 'failed', message: (e as Error).message });
    }
  }

  async function regenerate(): Promise<void> {
    setState({ kind: 'generating' });
    try {
      await fetch(`/api/v1/sessions/${sessionId}/generate-note`, { method: 'POST' });
    } catch {
      /* polling surfaces the outcome */
    }
    void fetchDraft();
  }

  if (state.kind === 'loading' || state.kind === 'starting') {
    return (
      <Card className="p-8 text-center text-sm text-[var(--color-ink-3)]">
        {state.kind === 'starting' ? 'Preparing the encounter…' : 'Loading…'}
      </Card>
    );
  }

  if (state.kind === 'idle') {
    return (
      <Card className="space-y-4 p-8 text-center">
        <p className="text-sm text-[var(--color-ink-2)]">
          {mode === 'upload'
            ? 'Upload a recording of the visit — the medical note drafts itself from the audio; you confirm and sign it.'
            : 'Dictate the visit in your own words — symptoms, findings, diagnosis, and your plan. The note drafts itself; you confirm and sign it.'}
        </p>
        <div className="flex justify-center">
          <Button onClick={beginRecording}>
            {mode === 'upload' ? 'Choose a recording' : '● Begin dictation'}
          </Button>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">
          Confirms the patient&rsquo;s recording consent for this encounter, then starts.
        </p>
      </Card>
    );
  }

  if (state.kind === 'recording') {
    // DS11.7 — mode-aware capture: dictation mic vs file upload, both
    // landing on the same generate-note pipeline + ReviewAndSign.
    return mode === 'upload' ? (
      <FileUploadPanel
        sessionId={sessionId}
        clientName={clientName}
        modality={null}
        onFinished={() => setState({ kind: 'generating' })}
      />
    ) : (
      <LiveRecorder
        sessionId={sessionId}
        clientName={clientName}
        modality={null}
        source="dictation"
        reviewHref={reviewHref}
        onFinished={() => setState({ kind: 'generating' })}
      />
    );
  }

  if (state.kind === 'generating') {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-medium text-[var(--color-ink)]">Writing the note…</p>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          Transcribing the encounter and drafting the medical note. This usually takes a few
          seconds.
        </p>
      </Card>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Card className="space-y-4 p-8 text-center">
        <p className="text-sm text-[var(--color-warn)]">{state.message}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={regenerate} variant="secondary">
            Re-run
          </Button>
          <Button onClick={() => router.refresh()} variant="ghost">
            Reload
          </Button>
        </div>
      </Card>
    );
  }

  // done — the single shared review-and-sign surface (DS11.2).
  return <ReviewAndSign sessionId={sessionId} clientId={clientId} note={state.note} />;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `${fallback} (${res.status}).`;
}
