'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { flushPendingWithRetries } from '@cureocity/audio';
import { useSessionRecorder, type CaptureSource } from '@/lib/audio/use-session-recorder';
import { useWakeLock } from '@/lib/audio/use-wake-lock';

const MODE_LABEL: Record<CaptureSource, string> = {
  mic: 'In-person',
  display: 'Virtual session',
  dictation: 'Dictation',
};

interface Props {
  sessionId: string;
  clientName: string;
  /// Sprint 19 — nullable: INTAKE sessions can defer the choice.
  modality: string | null;
  source: CaptureSource;
  onFinished: () => void;
  /// Sprint DV3 — where to navigate after the session ends. Defaults to
  /// the therapy session workspace; the doctor encounter passes its own.
  reviewHref?: string;
}

export function LiveRecorder({
  sessionId,
  clientName,
  modality,
  source,
  onFinished,
  reviewHref,
}: Props) {
  const router = useRouter();
  const recorder = useSessionRecorder({ sessionId, source });
  useWakeLock(recorder.state === 'recording');

  const [elapsedMs, setElapsedMs] = useState(0);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  // FLOW-2 — how many chunks are still uploading while we hold "End", and
  // whether the queue never drained (→ ask the therapist to confirm an
  // incomplete note rather than silently building one from partial audio).
  const [uploadingLeft, setUploadingLeft] = useState<number | null>(null);
  const [incompleteLeft, setIncompleteLeft] = useState(0);

  // Auto-start when this panel mounts. The pre-record wizard has already
  // moved the session into IN_PROGRESS, so the user expects to be live
  // immediately.
  useEffect(() => {
    if (recorder.state === 'idle') void recorder.start();
  }, []);

  // Live elapsed timer.
  useEffect(() => {
    if (recorder.state !== 'recording' || !recorder.startedAt) return;
    const id = setInterval(() => setElapsedMs(Date.now() - recorder.startedAt!), 250);
    setElapsedMs(Date.now() - recorder.startedAt);
    return () => clearInterval(id);
  }, [recorder.state, recorder.startedAt]);

  // FLOW-2 — end + generate ONLY once the upload queue is empty (or the
  // therapist explicitly accepts an incomplete note). `force` skips the
  // queue gate for the "End anyway" confirm.
  async function endSession(force = false): Promise<void> {
    setEndError(null);
    setIncompleteLeft(0);
    setEnding(true);
    try {
      await recorder.stop();

      // Hold until the tail of the recording is safely on the server. On
      // clinic Wi-Fi the last chunks often land seconds after stop(); ending
      // now would build a COMPLETED note missing the session's tail (where
      // risk + homework often live). Retry-drain, showing "n left".
      if (!force) {
        setUploadingLeft(recorder.pendingCount);
        const remaining = await flushPendingWithRetries(recorder.drainPending, {
          onProgress: (left) => setUploadingLeft(left),
        });
        setUploadingLeft(null);
        if (remaining > 0) {
          // Couldn't flush — don't silently ship a partial note. Surface an
          // explicit confirm; the therapist decides.
          setIncompleteLeft(remaining);
          setEnding(false);
          return;
        }
      } else {
        setUploadingLeft(null);
      }

      const res = await fetch(`/api/v1/sessions/${sessionId}/end`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `End failed (${res.status})`);
      }
      // Kick off note generation; don't block the redirect. The session
      // detail page polls the draft status, so the user immediately sees
      // "Generating note…" and watches it flip to COMPLETED.
      //
      // keepalive: the redirect below navigates away from this page
      // immediately. Without keepalive the browser ABORTS this in-flight
      // POST, leaving the draft stuck PENDING and the review screen
      // spinning forever. keepalive lets the request finish during the
      // navigation. As a backstop, the Notes tab also detects a stuck
      // PENDING/IN_PROGRESS draft and offers a manual resume.
      void fetch(`/api/v1/sessions/${sessionId}/generate-note`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => {
        /* swallow — the polling UI surfaces real failures */
      });
      router.push(reviewHref ?? `/app/sessions/${sessionId}`);
      onFinished();
    } catch (e) {
      setEndError((e as Error).message);
      setUploadingLeft(null); // don't leave a stuck "Uploading…" state on error
    } finally {
      setEnding(false);
    }
  }

  const isRecording = recorder.state === 'recording';
  const isPreparing = recorder.state === 'preparing';
  const errored = recorder.state === 'error' || recorder.error !== null;

  return (
    <Card className="overflow-hidden">
      <div
        className={`border-b border-[var(--color-line-soft)] px-6 py-4 ${
          isRecording ? 'bg-[#fbe9dc]/40' : 'bg-[var(--color-surface-soft)]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isRecording && (
              <span aria-hidden className="relative flex h-2.5 w-2.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-warn)] opacity-75" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--color-warn)]" />
              </span>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                {isRecording ? 'Recording' : isPreparing ? 'Preparing' : recorder.state}
              </p>
              <p className="mt-0.5 text-base font-medium">{clientName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-ink-2)]">
            <Badge tone="muted">{MODE_LABEL[source]}</Badge>
            <Badge tone="muted">{modality ?? 'Modality TBD'}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
        <StatTile
          label="Elapsed"
          value={formatElapsed(elapsedMs)}
          mono
          tone={isRecording ? 'warn' : 'default'}
        />
        <StatTile
          label="Chunks recorded"
          value={String(Math.max(recorder.lastChunkIndex + 1, 0))}
          mono
        />
        <StatTile
          label="Pending upload"
          value={`${recorder.pendingCount}${recorder.draining ? ' • syncing' : ''}`}
          mono
          tone={recorder.pendingCount > 0 ? 'accent' : 'default'}
        />
      </div>

      {errored && (
        <div className="mx-6 mb-4 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          {recorder.error ?? 'The recorder hit an error.'}
        </div>
      )}
      {endError && (
        <div className="mx-6 mb-4 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          Could not end session: {endError}
        </div>
      )}

      {/* FLOW-2 — hold while the tail of the recording finishes uploading. */}
      {uploadingLeft !== null && uploadingLeft > 0 && (
        <div className="mx-6 mb-4 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-ink-2)]">
          Uploading the last part of the recording… {uploadingLeft} left. Please stay on this page.
        </div>
      )}

      {/* FLOW-2 — the queue never drained; don't ship a partial note silently. */}
      {incompleteLeft > 0 && (
        <div className="mx-6 mb-4 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          <p className="font-medium">
            {incompleteLeft} part{incompleteLeft === 1 ? '' : 's'} of the recording didn&rsquo;t
            upload.
          </p>
          <p className="mt-1">
            Check your connection and try ending again. If you end now, the note may be missing the
            last part of the session.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void endSession(false)} disabled={ending}>
              Retry upload
            </Button>
            <Button
              variant="secondary"
              onClick={() => void endSession(true)}
              disabled={ending}
              className="text-[var(--color-warn)]"
            >
              End anyway (note may be incomplete)
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line-soft)] bg-white px-6 py-4">
        <p className="text-xs text-[var(--color-ink-3)]">
          Session is auto-saved every chunk. If your browser refreshes, recording resumes from the
          next chunk.
        </p>
        <Button
          onClick={() => void endSession(false)}
          disabled={ending || isPreparing || recorder.state === 'finishing'}
          className="bg-[var(--color-warn)] hover:bg-[#a25b30]"
        >
          {uploadingLeft !== null && uploadingLeft > 0
            ? `Uploading… (${uploadingLeft})`
            : ending
              ? 'Ending…'
              : 'End session'}
        </Button>
      </div>
    </Card>
  );
}

function StatTile({
  label,
  value,
  mono,
  tone = 'default',
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'warn' | 'accent';
}) {
  const ring =
    tone === 'warn'
      ? 'border-[var(--color-warn)]'
      : tone === 'accent'
        ? 'border-[var(--color-accent)]'
        : 'border-[var(--color-line)]';
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 ${ring}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
        {label}
      </p>
      <p className={`mt-1 text-2xl ${mono ? 'tabular-nums font-mono' : 'font-serif'}`}>{value}</p>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
