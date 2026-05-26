'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSessionRecorder } from '@/lib/audio/use-session-recorder';
import { useWakeLock } from '@/lib/audio/use-wake-lock';
import { tUi, type UiLocale } from '@/lib/i18n';
import { SessionStore } from '@/lib/audio/idb-chunk-store';

const SCRIBE_BASE = process.env.NEXT_PUBLIC_SCRIBE_SERVICE_BASE ?? 'http://localhost:3002/api/v1';

/**
 * SessionScreen — live ambient capture.
 *
 * Composes:
 *   useSessionRecorder — getUserMedia + AudioWorklet + IDB + uploader
 *   useWakeLock — keeps the screen on while recording
 *
 * Shows: state badge, last chunk index, pending count, network drain
 * status, recovery banner if a saved cursor exists for this session.
 *
 * Session-resume (gap G2): on mount, if SessionStore.getCursor(sessionId)
 * returns a row, the page shows the recovery banner. start() reads
 * the cursor and resumes the chunkIndex.
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

  useEffect(() => {
    void SessionStore.getCursor(params.sessionId).then((c) => {
      if (c) setResumeCandidate({ nextChunkIndex: c.nextChunkIndex });
    });
  }, [params.sessionId]);

  const isRecording = recorder.state === 'recording';

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Session {params.sessionId}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">
          {isRecording
            ? tUi(locale, 'session.recording')
            : recorder.state === 'preparing'
              ? tUi(locale, 'session.preparing')
              : recorder.state === 'finishing'
                ? tUi(locale, 'session.finishing')
                : 'Ready to record'}
        </h1>
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
          onClick={() => void recorder.start()}
          className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-4 text-base font-medium text-white"
        >
          {tUi(locale, 'session.start')}
        </button>
      ) : (
        <button
          type="button"
          onClick={async () => {
            await recorder.stop();
            router.push(`/clients/${params.clientId}/sessions/${params.sessionId}/review` as never);
          }}
          disabled={recorder.state !== 'recording'}
          className="w-full rounded-md bg-red-600 px-4 py-4 text-base font-medium text-white disabled:opacity-50"
        >
          {tUi(locale, 'session.stop')}
        </button>
      )}

      {recorder.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {tUi(locale, 'session.error')}: {recorder.error}
        </div>
      )}
    </main>
  );
}
