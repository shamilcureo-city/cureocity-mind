'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { flushPendingWithRetries } from '@cureocity/audio';
import { useSessionRecorder, type CaptureSource } from '@/lib/audio/use-session-recorder';
import { useWakeLock } from '@/lib/audio/use-wake-lock';
import { InRoomDirection } from './InRoomDirection';
import { coordinateMindSessionStart } from '@/lib/mind-session-start';
import { SessionStore } from '@/lib/audio/idb-chunk-store';
import { CaptureStatusBar } from './CaptureStatusBar';
import { useCaptureViewClock } from '@/lib/use-capture-view-clock';
import { useModalA11y } from '@/lib/use-modal-a11y';

const MODE_LABEL: Record<CaptureSource, string> = {
  mic: 'In-person',
  display: 'Virtual session',
  dictation: 'Dictation',
  external: 'Virtual · Cureocity room',
};

interface Props {
  sessionId: string;
  clientName: string;
  /**
   * TE2 — when set, the in-room direction rail is available during a batch
   * recording (the plan + carried questions). Omitted by the doctor
   * encounter, which has its own live consult surface.
   */
  clientId?: string;
  /// Sprint 19 — nullable: INTAKE sessions can defer the choice.
  modality: string | null;
  source: CaptureSource;
  /** VS1 — the virtual room's mixed call audio (source 'external'). */
  externalStream?: MediaStream;
  onFinished: () => void;
  /// Sprint DV3 — where to navigate after the session ends. Defaults to
  /// the therapy session workspace; the doctor encounter passes its own.
  reviewHref?: string;
  /**
   * VS1 — tells the parent whether a recording is in flight (recording /
   * draining / ending), so surfaces that embed the recorder (the virtual
   * room) can guard navigation that would silently abandon it.
   */
  onActiveChange?: (active: boolean) => void;
  selectedDeviceId?: string;
  /** Mind-only: lifecycle starts only after the recorder reports active capture. */
  authorizeMindAfterCaptureActive?: boolean;
}

export function LiveRecorder({
  sessionId,
  clientName,
  clientId,
  modality,
  source,
  externalStream,
  onFinished,
  reviewHref,
  onActiveChange,
  selectedDeviceId,
  authorizeMindAfterCaptureActive = false,
}: Props) {
  const router = useRouter();
  const recorder = useSessionRecorder({
    sessionId,
    source,
    ...(selectedDeviceId ? { selectedDeviceId } : {}),
    ...(externalStream && { externalStream }),
  });
  useWakeLock(recorder.state === 'recording');

  const [elapsedMs, setElapsedMs] = useState(0);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [captureAuthorizationError, setCaptureAuthorizationError] = useState<string | null>(null);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const endDialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(endConfirmOpen, endDialogRef, () => setEndConfirmOpen(false));
  const captureViewElapsedMs = useCaptureViewClock(
    recorder.state === 'recording',
    recorder.state === 'idle',
  );
  const [finalStage, setFinalStage] = useState<
    'stopping' | 'saving-recording' | 'generating-note' | 'ready' | null
  >(null);
  // FLOW-2 — how many chunks are still uploading while we hold "End", and
  // whether the queue never drained (→ ask the therapist to confirm an
  // incomplete note rather than silently building one from partial audio).
  const [uploadingLeft, setUploadingLeft] = useState<number | null>(null);
  const [incompleteLeft, setIncompleteLeft] = useState(0);
  const [captureAuthorized, setCaptureAuthorized] = useState(!authorizeMindAfterCaptureActive);
  const authorizationStartedRef = useRef(false);
  const captureOperationRef = useRef(0);
  const disposedRef = useRef(false);
  const finishedRef = useRef(false);
  const [resuming, setResuming] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const inputOffLabel =
    source === 'mic' || source === 'dictation' ? 'Microphone off' : 'Capture off';

  // Auto-start when this panel mounts. The pre-record wizard has already
  // moved the session into IN_PROGRESS, so the user expects to be live
  // immediately.
  useEffect(() => {
    disposedRef.current = false;
    if (recorder.state === 'idle') void recorder.start().catch(() => {});
    return () => {
      disposedRef.current = true;
      ++captureOperationRef.current;
    };
  }, []);

  useEffect(() => {
    if (!authorizeMindAfterCaptureActive || captureAuthorized || recorder.state !== 'recording')
      return;
    if (authorizationStartedRef.current) return;
    authorizationStartedRef.current = true;
    void coordinateMindSessionStart(
      { clientId: clientId ?? '', sessionId, captureMode: 'BATCH' },
      {
        selectOrReuseSession: async () => ({ id: sessionId, status: 'SCHEDULED' }),
        resolveConsent: async () => ({ sessionId, snapshotRecorded: true }),
        runPreflight: async () => ({ ready: true }),
        activateCapture: async () => ({ active: true }),
        authorizeCapture: async () => {
          const response = await fetch(`/api/v1/sessions/${sessionId}/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ captureMode: 'BATCH' }),
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Could not start session (${response.status}).`);
          }
        },
      },
    )
      .then(() => {
        if (disposedRef.current) return;
        setCaptureAuthorized(true);
        setCaptureAuthorizationError(null);
      })
      .catch((reason: unknown) => {
        if (disposedRef.current) return;
        setCaptureAuthorizationError((reason as Error).message);
        void recorder.stop().catch(() => {});
      });
  }, [authorizeMindAfterCaptureActive, captureAuthorized, clientId, recorder.state, sessionId]);

  function retryCaptureAuthorization(): void {
    if (disposedRef.current || finishedRef.current) return;
    authorizationStartedRef.current = false;
    setCaptureAuthorizationError(null);
    void recorder.start().catch(() => {});
  }

  async function pauseCapture(): Promise<void> {
    if (resuming || ending || recorder.state !== 'recording' || !captureAuthorized) return;
    ++captureOperationRef.current;
    setPauseError(null);
    try {
      await recorder.pause();
    } catch {
      setPauseError(
        'Capture is off, but the last audio could not be confirmed saved. Keep this page open and resolve the recording error before resuming.',
      );
    }
  }

  async function resumeCapture(): Promise<void> {
    if (disposedRef.current || finishedRef.current || resuming || ending) return;
    const operation = ++captureOperationRef.current;
    setResuming(true);
    setPauseError(null);
    try {
      if (clientId) {
        const response = await fetch(`/api/v1/sessions/${sessionId}/capture-resume`, {
          method: 'POST',
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            body.error ?? 'Could not reauthorize recording. Check consent before resuming.',
          );
        }
      }
      if (disposedRef.current || finishedRef.current || operation !== captureOperationRef.current)
        return;
      await recorder.start();
    } catch (reason) {
      if (!disposedRef.current && operation === captureOperationRef.current)
        setPauseError((reason as Error).message);
    } finally {
      if (!disposedRef.current && operation === captureOperationRef.current) setResuming(false);
    }
  }

  // VS1 — report whether a recording is in flight (anything between start and
  // a clean end), so the embedding surface can guard navigation. The unmount
  // cleanup reads the latest callback through a ref (mount-only effect).
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  }, [onActiveChange]);
  useEffect(() => {
    const active =
      recorder.state === 'recording' ||
      recorder.state === 'preparing' ||
      recorder.state === 'finishing' ||
      recorder.state === 'pausing' ||
      recorder.state === 'paused' ||
      resuming ||
      ending;
    onActiveChangeRef.current?.(active);
  }, [recorder.state, ending, resuming]);
  useEffect(() => {
    return () => onActiveChangeRef.current?.(false);
  }, []);

  // Live elapsed timer.
  useEffect(() => {
    if (!['recording', 'pausing', 'paused'].includes(recorder.state) || !recorder.startedAt) return;
    const id = setInterval(() => setElapsedMs(Date.now() - recorder.startedAt!), 250);
    setElapsedMs(Date.now() - recorder.startedAt);
    return () => clearInterval(id);
  }, [recorder.state, recorder.startedAt]);

  // Never generate a silently incomplete clinical note from a partial upload.
  async function endSession(retryUploads = false): Promise<void> {
    if (resuming || recorder.state === 'pausing') return;
    finishedRef.current = true;
    ++captureOperationRef.current;
    setEndError(null);
    setIncompleteLeft(0);
    setEnding(true);
    setFinalStage('stopping');
    try {
      await recorder.stop();
      setFinalStage('saving-recording');

      // Hold until the tail of the recording is safely on the server. On
      // clinic Wi-Fi the last chunks often land seconds after stop(); ending
      // now would build a COMPLETED note missing the session's tail (where
      // risk + homework often live). Retry-drain, showing "n left".
      setUploadingLeft(recorder.pendingCount);
      if (retryUploads) await recorder.drainPending(true);
      const remaining = await flushPendingWithRetries(recorder.drainPending, {
        onProgress: (left) => setUploadingLeft(left),
      });
      setUploadingLeft(null);
      if (remaining > 0) {
        setIncompleteLeft(remaining);
        setEnding(false);
        return;
      }

      const res = await fetch(`/api/v1/sessions/${sessionId}/end`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `End failed (${res.status})`);
      }
      setFinalStage('generating-note');
      await SessionStore.clear(sessionId);
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
  const captureActions = (
    <>
      {clientId && (isRecording || recorder.state === 'pausing') && (
        <Button
          variant="secondary"
          onClick={() => void pauseCapture()}
          disabled={ending || !captureAuthorized || recorder.state === 'pausing'}
        >
          {recorder.state === 'pausing' ? 'Pausing…' : 'Pause recording'}
        </Button>
      )}
      {clientId && recorder.state === 'paused' && (
        <Button
          variant="secondary"
          onClick={() => void resumeCapture()}
          disabled={resuming || ending}
        >
          {resuming ? 'Resuming…' : 'Resume recording'}
        </Button>
      )}
      <Button
        onClick={() => setEndConfirmOpen(true)}
        disabled={
          ending ||
          resuming ||
          isPreparing ||
          recorder.state === 'pausing' ||
          recorder.state === 'finishing' ||
          !captureAuthorized
        }
        variant={clientId ? 'secondary' : 'primary'}
        className={clientId ? undefined : 'bg-[var(--color-warn)] hover:bg-[#a25b30]'}
      >
        {uploadingLeft !== null && uploadingLeft > 0
          ? `Uploading… (${uploadingLeft})`
          : ending
            ? 'Ending…'
            : 'End session'}
      </Button>
    </>
  );

  return (
    <Card className={clientId ? '' : 'overflow-hidden'}>
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

      {clientId && (
        <CaptureStatusBar
          status={
            isRecording
              ? 'Recording'
              : resuming
                ? 'Reconnecting capture'
                : recorder.state === 'paused'
                  ? 'Paused · microphone off'
                  : recorder.state === 'pausing'
                    ? 'Capture off · saving the last audio'
                    : isPreparing
                      ? 'Preparing capture'
                      : 'Capture stopped'
          }
          elapsedMs={captureViewElapsedMs}
          detail={
            recorder.pendingCount > 0
              ? 'Some captured audio is still uploading. Keep this page open until saving is confirmed.'
              : isRecording
                ? 'Recording only. A draft will be prepared after you end and save.'
                : 'No new audio is captured. Keep this page open if saving is unfinished.'
          }
        >
          {captureActions}
        </CaptureStatusBar>
      )}

      {clientId ? (
        <details className="px-6 py-3 text-sm text-[var(--color-ink-2)]">
          <summary className="min-h-11 cursor-pointer py-2">Recording details</summary>
          <p>
            {Math.max(recorder.lastChunkIndex + 1, 0)} audio parts captured; {recorder.pendingCount}{' '}
            pending upload{recorder.draining ? ' · syncing' : ''}.
          </p>
        </details>
      ) : (
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
          <StatTile
            label="Session elapsed · includes breaks"
            value={formatElapsed(elapsedMs)}
            mono
            tone={isRecording ? 'warn' : 'default'}
          />
          <StatTile
            label="Audio parts captured"
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
      )}

      {(recorder.state === 'paused' || recorder.state === 'pausing' || resuming || pauseError) && (
        <div
          role="status"
          className="mx-6 mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm"
        >
          <p className="font-medium">
            {resuming
              ? 'Resuming capture…'
              : `${inputOffLabel} · ${recorder.state === 'pausing' ? 'saving the last audio…' : recorder.state === 'paused' ? 'capture paused' : 'capture stopped'}`}
          </p>
          <p className="mt-1">
            {resuming
              ? 'Rechecking consent and reconnecting the audio source. Wait for Recording before continuing.'
              : 'No new audio is being recorded. This session has not ended.'}{' '}
            {source === 'external' ? 'The call itself remains connected.' : ''}
          </p>
          {pauseError && <p className="mt-2 text-[var(--color-warn)]">{pauseError}</p>}
        </div>
      )}

      {errored && (
        <div className="mx-6 mb-4 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          {recorder.error ?? 'The recorder hit an error.'}
          {!isRecording && !captureAuthorizationError && (
            <Button
              variant="secondary"
              disabled={resuming || ending || finishedRef.current}
              onClick={() => void resumeCapture()}
            >
              Resume capture
            </Button>
          )}
        </div>
      )}
      {captureAuthorizationError && (
        <div className="mx-6 mb-4 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          <p>
            The session could not be marked in progress. Capture was stopped; keep this page open if
            saving is unfinished: {captureAuthorizationError}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={retryCaptureAuthorization}
              disabled={recorder.state === 'finishing' || recorder.state === 'preparing'}
            >
              Retry start
            </Button>
          </div>
        </div>
      )}
      {endError && (
        <div className="mx-6 mb-4 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          <p>Could not finish the session: {endError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void endSession(true)} disabled={ending}>
              Retry finalization
            </Button>
            <p className="text-xs">Keep this page open until all captured audio is saved.</p>
          </div>
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
            Check your connection and retry uploading. Note generation is paused until every
            captured part is uploaded. Keep this page open.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void endSession(true)} disabled={ending}>
              Retry upload
            </Button>
          </div>
        </div>
      )}

      {/* Only while a session is actually happening. `dictation` is a
          post-hoc summary — the session is over, so a forward-looking plan
          would be as wrong there as it was on the confirm screen. */}
      {clientId && source !== 'dictation' && <InRoomDirection clientId={clientId} />}

      {endConfirmOpen && (
        <div
          ref={endDialogRef}
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="End session?"
        >
          <Card className="w-full max-w-md p-6">
            <h2 className="font-serif text-xl">End this session?</h2>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Recording will stop, finish uploading, and save before note generation begins.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEndConfirmOpen(false)}>
                {recorder.state === 'paused' ? 'Stay paused' : 'Keep recording'}
              </Button>
              <Button
                onClick={() => {
                  setEndConfirmOpen(false);
                  void endSession(false);
                }}
              >
                End &amp; save
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div
        className={
          clientId
            ? 'flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line-soft)] px-6 py-4'
            : 'sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-[var(--color-line-soft)] bg-white/95 px-6 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur'
        }
      >
        <p className="text-xs text-[var(--color-ink-3)]">
          {finalStage === 'stopping'
            ? 'Stopping capture…'
            : finalStage === 'saving-recording'
              ? 'Saving recording…'
              : finalStage === 'generating-note'
                ? 'Audio uploaded. Opening the session to review note generation…'
                : 'Saved audio parts can resume after reopening this session. Keep this page open while recording or saving.'}
        </p>
        {!clientId && <div className="flex shrink-0 flex-wrap gap-2">{captureActions}</div>}
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
