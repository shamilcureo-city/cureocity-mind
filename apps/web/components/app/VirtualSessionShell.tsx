'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Card } from '../ui/Card';
import { VideoSessionRoom } from '../video/VideoSessionRoom';
import { LiveRecorder } from './LiveRecorder';

/**
 * VS1 — the Record screen's "Virtual" surface: the LiveKit room and the
 * scribe recorder on ONE page.
 *
 * The piece that makes this worth building is the audio path. Recording a
 * video call through the laptop mic barely hears the client (and hears
 * nothing with headphones). Here the browser MIXES the therapist's mic and
 * the client's incoming call audio with WebAudio and hands that stream to
 * the exact same chunk pipeline walk-in sessions use — so transcription,
 * the note and the copilot all receive clean, both-sided audio without a
 * single downstream change.
 *
 * The mixer is LONG-LIVED: one AudioContext + destination for the whole
 * page life, so the recorder's stream identity never changes. A dropped
 * call + Rejoin simply attaches the new room's tracks into the same
 * destination and the SAME recording continues — tearing the mixer down on
 * disconnect made the recorder consume a dead stream (post-rejoin audio
 * became silence in the transcript).
 *
 * Navigation is guarded while a recording is in flight: the hang-up button
 * and the workspace link route through the recorder's state, because the
 * natural "call is over" gestures must not silently abandon the recording —
 * End session is what flushes the audio and generates the note.
 */
export function VirtualSessionShell({
  sessionId,
  clientId,
  clientName,
  modality,
}: {
  sessionId: string;
  clientId: string;
  clientName: string;
  modality: string | null;
}) {
  const router = useRouter();
  const workspaceHref = `/app/sessions/${sessionId}?tab=copilot`;

  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mixedStream, setMixedStream] = useState<MediaStream | null>(null);
  // The recorder is mid-flight (recording / draining / ending).
  const [recActive, setRecActive] = useState(false);
  const recActiveRef = useRef(false);
  // The therapist hung up while the recording was still running — guide them
  // to End session instead of leaving them to wander off.
  const [callEndedNotice, setCallEndedNotice] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const attachedTrackIds = useRef<Set<string>>(new Set());

  // The share link comes from the same endpoint the room component uses for
  // its token; fetching here keeps the link on screen before the room is
  // even joined (the moment the therapist most needs to send it).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/video-token`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as {
          joinUrl?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !body.joinUrl) {
          setLinkError(body.error ?? 'Could not prepare the client link.');
          return;
        }
        setJoinUrl(body.joinUrl);
      } catch (e) {
        if (!cancelled) setLinkError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Close the mixer only when the PAGE goes away — never on a call drop.
  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      destRef.current = null;
    };
  }, []);

  // A hard navigation / tab close mid-recording gets the browser's native
  // "Leave site?" dialog. (Client-side navigations are guarded separately.)
  useEffect(() => {
    if (!recActive) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [recActive]);

  const attachTrack = useCallback((mediaTrack: MediaStreamTrack | undefined) => {
    const ctx = audioCtxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest || !mediaTrack) return;
    if (attachedTrackIds.current.has(mediaTrack.id)) return;
    attachedTrackIds.current.add(mediaTrack.id);
    const source = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
    source.connect(dest);
  }, []);

  const ensureMixer = useCallback(() => {
    if (audioCtxRef.current && destRef.current) return;
    const ctx = new AudioContext({ sampleRate: 48_000 });
    const dest = ctx.createMediaStreamDestination();
    audioCtxRef.current = ctx;
    destRef.current = dest;
    setMixedStream(dest.stream);
  }, []);

  const onRoom = useCallback(
    (room: Room | null) => {
      if (!room) {
        // The call dropped or was left. Keep the mixer AND the recorder
        // alive: the destination stream's identity never changes, so a
        // rejoin's fresh tracks continue the same recording. (Ended sources
        // just go silent — a real gap in the call is a real gap on tape.)
        return;
      }
      setCallEndedNotice(false);
      ensureMixer();

      // Everything already in the room…
      for (const pub of room.localParticipant.audioTrackPublications.values()) {
        attachTrack(pub.track?.mediaStreamTrack);
      }
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.audioTrackPublications.values()) {
          attachTrack(pub.track?.mediaStreamTrack);
        }
      }
      // …and everything that arrives later (late joins, reconnects).
      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.kind === Track.Kind.Audio) attachTrack(pub.track?.mediaStreamTrack);
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) attachTrack(track.mediaStreamTrack);
      });
    },
    [attachTrack, ensureMixer],
  );

  const onRecorderActive = useCallback((active: boolean) => {
    recActiveRef.current = active;
    setRecActive(active);
  }, []);

  // The room's hang-up / Done. While recording: stay here and point at End
  // session (that's what generates the note). Otherwise: to the workspace.
  const onLeave = useCallback(() => {
    if (recActiveRef.current) {
      setCallEndedNotice(true);
      return;
    }
    router.push(workspaceHref);
  }, [router, workspaceHref]);

  const openWorkspace = useCallback(() => {
    if (recActiveRef.current) {
      const ok = window.confirm(
        'The recording is still running. Leaving now abandons it — no note will be generated. ' +
          'Use "End session" below to finish properly.\n\nLeave anyway?',
      );
      if (!ok) return;
    }
    router.push(workspaceHref);
  }, [router, workspaceHref]);

  const copyLink = useCallback(async () => {
    if (!joinUrl) return;
    await navigator.clipboard.writeText(joinUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [joinUrl]);

  const waMessage = joinUrl
    ? encodeURIComponent(
        `Hi — here's the secure link for our video session. It opens in your browser, nothing to install:\n${joinUrl}`,
      )
    : '';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openWorkspace}
          className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          Open session workspace →
        </button>
      </div>

      {/* The client link — front and centre before the call starts. */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              {clientName}&rsquo;s link to join
            </p>
            {joinUrl ? (
              <p className="mt-1 truncate font-mono text-xs text-[var(--color-ink-2)]">{joinUrl}</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--color-warn)]">
                {linkError ?? 'Preparing the secure link…'}
              </p>
            )}
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              disabled={!joinUrl}
              className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)] disabled:opacity-50"
            >
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
            <a
              href={joinUrl ? `https://wa.me/?text=${waMessage}` : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!joinUrl}
              className={`rounded-full bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white ${
                joinUrl ? 'hover:bg-[var(--color-accent-hover)]' : 'pointer-events-none opacity-50'
              }`}
            >
              WhatsApp
            </a>
          </div>
        </div>
      </Card>

      {/* The room. */}
      <div className="h-[52vh] min-h-[420px]">
        <VideoSessionRoom
          tokenEndpoint={`/api/v1/sessions/${sessionId}/video-token`}
          counterpartLabel={clientName}
          leaveHref={workspaceHref}
          chrome="embedded"
          onRoom={onRoom}
          onLeave={onLeave}
        />
      </div>

      {callEndedNotice && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="block">The call has ended — the recording is still running.</strong>
          <p className="mt-1">
            Finish with <strong>End session</strong> below: that uploads the audio and generates the
            note. If the call dropped by mistake, Rejoin above — the recording carries on through
            the gap.
          </p>
        </Card>
      )}

      {/* The scribe — same pipeline as walk-in, fed the mixed call audio. */}
      {mixedStream ? (
        <LiveRecorder
          sessionId={sessionId}
          clientId={clientId}
          clientName={clientName}
          modality={modality}
          source="external"
          externalStream={mixedStream}
          reviewHref={workspaceHref}
          onFinished={() => {}}
          onActiveChange={onRecorderActive}
        />
      ) : (
        <Card className="p-5 text-sm text-[var(--color-ink-2)]">
          Recording unlocks when you join the room above — the scribe captures the call itself (your
          voice and {clientName}&rsquo;s), not the laptop microphone.
        </Card>
      )}
    </div>
  );
}
