'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Session } from '@cureocity/contracts';
import { useSessionRecorder } from '@/lib/audio/use-session-recorder';
import { useWakeLock } from '@/lib/audio/use-wake-lock';
import { tUi, type UiLocale } from '@/lib/i18n';
import { SessionStore } from '@/lib/audio/idb-chunk-store';
import { TherapistApi } from '@/lib/therapist-api';

const SCRIBE_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

/**
 * SessionScreen — live ambient capture.
 *
 * Wires the session lifecycle:
 *   1. Start → ackSessionConsent (snapshot consents onto Session row)
 *              → startSession    (SCHEDULED → IN_PROGRESS)
 *              → begin local capture (audio worklet + chunk uploader)
 *   2. Stop  → stop capture, drain queued chunks
 *              → endSession      (IN_PROGRESS → COMPLETED, creates draft)
 *              → generateNote    (runs orchestrator inline)
 *              → navigate to /t/clients/.../review
 *
 * Session-resume (gap G2): if SessionStore.getCursor(sessionId) returns
 * a row, we show a recovery banner. start() reads the cursor and
 * resumes the chunkIndex without re-running the lifecycle setup.
 */
export default function CapturePage() {
  const params = useParams<{ clientId: string; sessionId: string }>();
  const router = useRouter();
  const locale: UiLocale = 'en';
  const recorder = useSessionRecorder({
    sessionId: params.sessionId,
    scribeBase: SCRIBE_BASE,
  });
  useWakeLock(recorder.state === 'recording');

  const [resumeCandidate, setResumeCandidate] = useState<{ nextChunkIndex: number } | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'opening' | 'closing'>('idle');
  const [sessionStatus, setSessionStatus] = useState<Session['status'] | null>(null);

  useEffect(() => {
    void SessionStore.getCursor(params.sessionId).then((c) => {
      if (c) setResumeCandidate({ nextChunkIndex: c.nextChunkIndex });
    });
  }, [params.sessionId]);

  async function handleStart(): Promise<void> {
    setLifecycleError(null);
    setPhase('opening');
    try {
      // First start: ack consent + transition state. On resume, both
      // are idempotent at the server (consent will 400 if non-SCHEDULED,
      // start will 400 likewise) — swallow the no-op errors quietly.
      if (sessionStatus !== 'IN_PROGRESS') {
        try {
          await TherapistApi.ackSessionConsent(params.sessionId, [
            'AUDIO_RECORDING',
            'AI_NOTE_GENERATION',
          ]);
        } catch (e) {
          if (!/SCHEDULED state/.test((e as Error).message)) throw e;
        }
        try {
          const updated = await TherapistApi.startSession(params.sessionId);
          setSessionStatus(updated.status);
        } catch (e) {
          if (!/SCHEDULED state/.test((e as Error).message)) throw e;
          setSessionStatus('IN_PROGRESS');
        }
      }
      await recorder.start();
    } catch (e) {
      setLifecycleError((e as Error).message);
    } finally {
      setPhase('idle');
    }
  }

  async function handleStop(): Promise<void> {
    setLifecycleError(null);
    setPhase('closing');
    try {
      await recorder.stop();
      try {
        await TherapistApi.endSession(params.sessionId);
      } catch (e) {
        // Allow re-entering this path if the session already ended
        // (e.g. tab closed mid-flow then re-opened).
        if (!/IN_PROGRESS state/.test((e as Error).message)) throw e;
      }
      // Fire generation but don't block the redirect — the review
      // screen polls draft status and shows a "generating…" state.
      void TherapistApi.generateNote(params.sessionId).catch(() => {
        /* surfaced on the review screen */
      });
      router.push(`/t/clients/${params.clientId}/sessions/${params.sessionId}/review`);
    } catch (e) {
      setLifecycleError((e as Error).message);
      setPhase('idle');
    }
  }

  const isRecording = recorder.state === 'recording';
  const heading = isRecording
    ? tUi(locale, 'session.recording')
    : recorder.state === 'preparing' || phase === 'opening'
      ? tUi(locale, 'session.preparing')
      : recorder.state === 'finishing' || phase === 'closing'
        ? tUi(locale, 'session.finishing')
        : 'Ready to record';

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Session {params.sessionId}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">{heading}</h1>
      </header>

      {resumeCandidate && recorder.state === 'idle' && resumeCandidate.nextChunkIndex > 0 && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {tUi(locale, 'session.recoveryBanner')} (chunk {resumeCandidate.nextChunkIndex})
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--color-slate-200)] bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
            {tUi(locale, 'session.chunksUploaded')}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {recorder.lastChunkIndex >= 0 ? recorder.lastChunkIndex + 1 : 0}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-slate-200)] bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
            {tUi(locale, 'session.pendingUpload')}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {recorder.pendingCount}
            {recorder.draining && (
              <span className="ml-2 text-xs font-normal text-[var(--color-slate-500)]">
                syncing…
              </span>
            )}
          </div>
        </div>
      </div>

      {recorder.state === 'recording' && (
        <div
          aria-live="polite"
          className="mb-6 flex items-center justify-center rounded-lg border-2 border-red-400 bg-red-50 py-4 text-red-700"
        >
          <span className="relative mr-3 flex h-3 w-3">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative h-3 w-3 rounded-full bg-red-500" />
          </span>
          {tUi(locale, 'session.recording')}
        </div>
      )}

      {recorder.state === 'idle' || recorder.state === 'error' ? (
        <button
          type="button"
          onClick={handleStart}
          disabled={phase === 'opening'}
          className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-4 text-base font-medium text-white disabled:opacity-50"
        >
          {phase === 'opening' ? tUi(locale, 'session.preparing') : tUi(locale, 'session.start')}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStop}
          disabled={recorder.state !== 'recording' || phase === 'closing'}
          className="w-full rounded-md bg-red-600 px-4 py-4 text-base font-medium text-white disabled:opacity-50"
        >
          {phase === 'closing' ? tUi(locale, 'session.finishing') : tUi(locale, 'session.stop')}
        </button>
      )}

      {(lifecycleError || recorder.error) && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {tUi(locale, 'session.error')}: {lifecycleError ?? recorder.error}
        </div>
      )}
    </main>
  );
}
