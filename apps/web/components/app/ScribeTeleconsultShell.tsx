'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useScribeCallAudio } from '@/lib/audio/use-scribe-call-audio';
import {
  SCRIBE_TELECONSULT_HEARTBEAT_MS,
  type ScribeTeleconsultManagement,
  type ScribeTeleconsultDocumentationState,
} from '@/lib/scribe-teleconsult-contracts';
import {
  teleconsultCaptureBlock,
  teleconsultConsentLabel,
} from '@/lib/scribe-teleconsult-readiness';
import { VideoSessionRoom } from '../video/VideoSessionRoom';
import { DoctorLiveEncounter } from './DoctorLiveEncounter';
import { ScribeTeleconsultSetup } from './ScribeTeleconsultSetup';
import styles from './ScribeTeleconsult.module.css';

type DocumentationState = ScribeTeleconsultDocumentationState;
type ManagementResponse = {
  configured?: boolean;
  record?: ScribeTeleconsultManagement | null;
  joinUrl?: string;
  roomTermination?: 'confirmed' | 'unconfirmed';
  error?: string;
};

export function ScribeTeleconsultShell({
  sessionId,
  clientId,
  patient,
  specialty,
  sessionClosed = false,
}: {
  sessionId: string;
  clientId: string;
  patient: { name: string; age: number | null };
  specialty: string | null;
  sessionClosed?: boolean;
}) {
  const endpoint = `/api/v1/scribe/encounters/${sessionId}/teleconsult`;
  const [record, setRecord] = useState<ScribeTeleconsultManagement | null>(null);
  const recordRef = useRef(record);
  const [configured, setConfigured] = useState(false);
  const [roomAuthorized, setRoomAuthorized] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [link, setLink] = useState<{ url: string; version: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [doctorConfirmed, setDoctorConfirmed] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [documentationState, setDocumentationState] = useState<DocumentationState>('idle');
  const mounted = useRef(true);
  const mutationControllers = useRef(new Set<AbortController>());
  const audio = useScribeCallAudio();
  const requestVersion = useRef(0);

  const applyRecord = useCallback((next: ScribeTeleconsultManagement | null) => {
    const previous = recordRef.current;
    if (next && previous?.id === next.id && previous.revision > next.revision) return;
    if (
      previous &&
      (previous.linkVersion !== next?.linkVersion || next?.patientConsent !== 'granted')
    )
      setDoctorConfirmed(false);
    recordRef.current = next;
    setRecord(next);
    setCheckedAt(Date.now());
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      const res = await fetch(endpoint, {
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(4_000)])
          : AbortSignal.timeout(4_000),
      });
      // Proxies/auth middleware may return an HTML denial; the status must
      // still revoke the local room instead of becoming a transient parse error.
      const body = (await res.json().catch(() => ({}))) as ManagementResponse;
      if (!mounted.current || version !== requestVersion.current) return;
      if (!res.ok) {
        if ([401, 403, 404].includes(res.status)) {
          setRoomAuthorized(false);
          setConfigured(false);
        }
        throw new Error(body.error ?? 'Could not check the consultation. AI capture is stopped.');
      }
      setConfigured(body.configured === true);
      setRoomAuthorized(body.configured === true);
      applyRecord(body.record ?? null);
      setStatusError(null);
    },
    [endpoint, applyRecord],
  );

  const mutate = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      if (!mounted.current) throw new Error('The consultation view is closed.');
      ++requestVersion.current; // Older polls cannot restore stale consent after a mutation.
      const controller = new AbortController();
      mutationControllers.current.add(controller);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, expectedRevision: recordRef.current?.revision, ...extra }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        });
        const body = (await res.json()) as ManagementResponse & { token?: string; url?: string };
        if (!res.ok) throw new Error(body.error ?? 'The change was not confirmed. Please retry.');
        if (mounted.current && body.record) {
          applyRecord(body.record);
          if (body.joinUrl) setLink({ url: body.joinUrl, version: body.record.linkVersion });
          if (body.roomTermination === 'unconfirmed')
            setError(
              'The invitation is closed, but closing the active call could not be confirmed. Ask both participants to leave the call.',
            );
        }
        return body;
      } finally {
        mutationControllers.current.delete(controller);
      }
    },
    [endpoint, applyRecord],
  );

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh(controller.signal);
      } catch {
        if (!controller.signal.aborted && mounted.current) {
          setCheckedAt(0);
          setStatusError(
            'Consent status is unavailable. AI documentation is stopped; check the connection.',
          );
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2_000);
    };
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      mounted.current = false;
      controller.abort();
      mutationControllers.current.forEach((pendingRequest) => pendingRequest.abort());
      mutationControllers.current.clear();
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [refresh]);

  // Leaving this screen while capturing must not silently discard the transcript.
  useEffect(() => {
    if (!captureBusy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return;
      if (
        !window.confirm(
          'AI documentation is unfinished. Use End & review note to save it before leaving. Leave anyway?',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
    };
  }, [captureBusy]);

  const onCaptureState = useCallback((state: DocumentationState, busy: boolean) => {
    setDocumentationState(state);
    setCaptureBusy(busy);
  }, []);
  // Preserve capture state order when consent checks, starts and stops overlap.
  const documentationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const publishDocumentation = useCallback(
    (state: DocumentationState, confirmedConsent = false) => {
      const request = documentationQueue.current
        .catch(() => {})
        .then(() => {
          if (!mounted.current) throw new Error('The consultation view is closed.');
          return mutate('documentation', {
            state,
            ...(confirmedConsent ? { confirmedConsent: true } : {}),
          });
        });
      documentationQueue.current = request;
      return request;
    },
    [mutate],
  );
  const previousState = useRef<DocumentationState>('idle');
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = documentationState;
    const send = () =>
      void publishDocumentation(documentationState).catch(() => {
        if (mounted.current) {
          setCheckedAt(0);
          setError('AI documentation status could not be confirmed. Capture is stopped.');
        }
      });
    if (documentationState === 'recording' || documentationState === 'draining') {
      send();
      const heartbeat = setInterval(send, 8_000);
      return () => clearInterval(heartbeat);
    }
    if (
      (documentationState === 'paused' &&
        ['preparing', 'recording', 'draining'].includes(previous)) ||
      documentationState === 'finished'
    )
      send();
    return undefined;
  }, [documentationState, publishDocumentation]);

  const captureBlock = teleconsultCaptureBlock({
    configured,
    record,
    checkedAt,
    now,
    doctorConfirmed,
    audioReady: audio.ready,
    audioError: audio.error,
  });
  const heartbeatAt = record?.documentationHeartbeatAt
    ? Date.parse(record.documentationHeartbeatAt)
    : NaN;
  const serverPaused =
    documentationState === 'recording' &&
    (!['preparing', 'recording'].includes(record?.documentationState ?? '') ||
      !Number.isFinite(heartbeatAt) ||
      now - heartbeatAt >= SCRIBE_TELECONSULT_HEARTBEAT_MS);
  const block =
    captureBlock ??
    (serverPaused
      ? 'AI documentation was paused or could not be confirmed. Resume explicitly after checking the call.'
      : null);
  const latestBlock = useRef(block);
  latestBlock.current = block;
  const prepareCapture = useCallback(async () => {
    if (latestBlock.current) throw new Error(latestBlock.current);
    await audio.resume();
    await publishDocumentation('preparing', true);
    if (latestBlock.current) throw new Error(latestBlock.current);
  }, [audio.resume, publishDocumentation]);

  const requestToken = useCallback(
    async (signal: AbortSignal) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'token' }),
        signal,
      });
      const body = (await res.json()) as { token?: string; url?: string; error?: string };
      if (!res.ok || !body.token || !body.url)
        throw new Error(body.error ?? 'Could not join this video consultation.');
      return { token: body.token, url: body.url };
    },
    [endpoint],
  );

  async function manage(action: 'create-link' | 'rotate' | 'revoke' | 'end') {
    if (captureBusy) return;
    if (
      (action === 'rotate' || action === 'revoke' || action === 'end') &&
      !window.confirm(
        action === 'rotate'
          ? 'Replace this invitation? The previous link and active call will close.'
          : 'Close this invitation and any active video call?',
      )
    )
      return;
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      await mutate(action);
      if (action === 'revoke' || action === 'end') setLink(null);
    } catch (e) {
      setError((e as Error).message);
      setCheckedAt(0);
    } finally {
      setPending(false);
    }
  }
  async function copyLink() {
    if (!link || link.version !== record?.linkVersion) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError(
        'Clipboard access was blocked. Allow clipboard access and try Copy patient link again.',
      );
    }
  }

  const invitationOpen = record?.status === 'open' && Date.parse(record.expiresAt) > now;
  return (
    <div className={styles.surface}>
      <p className={styles.notice}>
        Joining the call does not start AI documentation. Use the separate capture controls below.
        Audio is streamed for transcription; this feature does not record video.
      </p>
      {error && (
        <p role="alert" className={`${styles.notice} ${styles.warning} mt-4`}>
          {error}
        </p>
      )}
      {statusError && (
        <p role="alert" className={`${styles.notice} ${styles.warning} mt-4`}>
          {statusError}
        </p>
      )}
      <ScribeTeleconsultSetup
        room={
          invitationOpen && roomAuthorized ? (
            <VideoSessionRoom
              key={record.linkVersion}
              tokenEndpoint={endpoint}
              requestToken={requestToken}
              counterpartLabel={patient.name}
              leaveHref={`/app/patients/${clientId}/encounters/${sessionId}`}
              title="Your video consultation"
              joinLabel="Join consultation"
              leaveLabel="Leave call"
              chrome="embedded"
              onRoom={audio.onRoom}
              onLeave={() => {}}
            />
          ) : (
            <div className={styles.empty}>
              <h2>Your consultation room</h2>
              <p>
                {configured
                  ? 'Create a patient invitation, then join the call. AI documentation stays off until you start it.'
                  : 'Video is not configured here yet. No camera or microphone has been opened.'}
              </p>
            </div>
          )
        }
        consentLabel={teleconsultConsentLabel(record?.patientConsent)}
        doctorConfirmed={doctorConfirmed}
        onConfirm={setDoctorConfirmed}
        localAudioReady={audio.localAudioReady}
        remoteAudioReady={audio.remoteAudioReady}
        captureBusy={captureBusy}
        linkAvailable={!!link && link.version === record?.linkVersion && invitationOpen}
        invitationOpen={invitationOpen}
        pending={pending}
        canManage={configured && !sessionClosed && record?.status !== 'ended'}
        copied={copied}
        expiresAt={record?.expiresAt}
        onCreateLink={() => void manage(record ? 'rotate' : 'create-link')}
        onCopyLink={() => void copyLink()}
        onRevoke={() => void manage('revoke')}
        onEnd={() => void manage('end')}
      />
      {sessionClosed ? (
        <p className={styles.notice}>
          AI documentation has finished for this encounter. The video discussion can continue until
          you end it.{' '}
          <a className="underline" href={`/app/patients/${clientId}/encounters/${sessionId}`}>
            Open the saved encounter to review its clinical record.
          </a>
        </p>
      ) : (
        <DoctorLiveEncounter
          sessionId={sessionId}
          clientId={clientId}
          patient={patient}
          specialty={specialty}
          autoStart={false}
          teleconsult={{
            stream: audio.stream,
            ready: block === null,
            unavailableReason: block,
            beforeStart: prepareCapture,
            onStateChange: onCaptureState,
          }}
        />
      )}
    </div>
  );
}
