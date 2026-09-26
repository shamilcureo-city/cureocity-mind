'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  LocalVideoTrack,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  createLocalTracks,
  type LocalTrack,
} from 'livekit-client';

/**
 * MK9 — the 1:1 session room, shared by therapist and patient pages.
 *
 * Deliberately minimal and calm: remote person fills the frame, you
 * ride in a corner tile, three controls (mic / camera / leave).
 * LiveKit's client handles reconnection; we narrate its states in
 * plain words ("Reconnecting…") instead of dropping the call.
 *
 * Audio-first: if bandwidth degrades LiveKit sheds video before audio,
 * which is the right trade for therapy.
 */

interface Props {
  /** Endpoint that mints this participant's token (POST). */
  tokenEndpoint: string;
  /** Who the OTHER side is, for waiting/empty states. */
  counterpartLabel: string;
  /** Where Leave goes. */
  leaveHref: string;
  /**
   * VS1 — the virtual-session surface embeds the room beside the recorder,
   * so 'embedded' fills the parent instead of claiming the viewport.
   */
  chrome?: 'full' | 'embedded';
  /**
   * VS1 — hands the connected Room to the parent (null on disconnect/error)
   * so the recorder can mix local mic + remote audio into the scribe
   * pipeline. Display stays this component's job.
   */
  onRoom?: (room: Room | null) => void;
  /**
   * VS1 — when set, the hang-up button and the ended panel's Done do NOT
   * navigate to leaveHref; the parent decides (the therapist shell keeps the
   * recorder alive and guides the therapist to End session instead).
   */
  onLeave?: () => void;
  /** Optional secure token transport; legacy session endpoints remain unchanged. */
  requestToken?: (signal: AbortSignal) => Promise<{ token: string; url: string }>;
  title?: string;
  joinLabel?: string;
  leaveLabel?: string;
}

type Phase =
  | 'idle'
  | 'requesting-devices'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'ended'
  | 'over'
  | 'error';

export function VideoSessionRoom({
  tokenEndpoint,
  counterpartLabel,
  leaveHref,
  chrome = 'full',
  onRoom,
  onLeave,
  requestToken,
  title = 'Your video session',
  joinLabel = 'Join session',
  leaveLabel = 'Leave session',
}: Props) {
  const heightCls =
    chrome === 'embedded' ? 'h-full min-h-[420px] overflow-hidden rounded-3xl' : 'min-h-screen';
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remotePresent, setRemotePresent] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const tracksRef = useRef<LocalTrack[]>([]);
  const joinRequestRef = useRef<AbortController | null>(null);
  const joinGenerationRef = useRef(0);
  const joiningRef = useRef(false);
  const onRoomRef = useRef(onRoom);
  useEffect(() => {
    onRoomRef.current = onRoom;
  }, [onRoom]);

  const releaseRoom = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values())
          publication.track?.detach();
      }
    }
    for (const track of tracksRef.current) {
      track.detach();
      track.stop();
    }
    tracksRef.current = [];
    void room?.disconnect();
    onRoomRef.current?.(null);
  }, []);

  const attachRemote = useCallback((track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
      track.attach(remoteVideoRef.current);
    }
    if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
      track.attach(remoteAudioRef.current);
    }
  }, []);

  // A fast connection can publish/subscribe before React mounts the media
  // elements. Reattach existing tracks once the in-call frame has committed.
  useEffect(() => {
    const room = roomRef.current;
    if (!room || (phase !== 'connecting' && phase !== 'live' && phase !== 'reconnecting')) return;
    for (const publication of room.localParticipant.trackPublications.values()) {
      if (publication.track?.kind === Track.Kind.Video && localVideoRef.current)
        (publication.track as LocalVideoTrack).attach(localVideoRef.current);
    }
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) attachRemote(publication.track);
      }
    }
  }, [phase, remotePresent, attachRemote]);

  const join = useCallback(async () => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    const generation = ++joinGenerationRef.current;
    const controller = new AbortController();
    joinRequestRef.current?.abort();
    joinRequestRef.current = controller;
    releaseRoom();
    const isCurrent = () => generation === joinGenerationRef.current && !controller.signal.aborted;
    setPhase('requesting-devices');
    setMessage(null);
    try {
      let credentials: { token: string; url: string };
      if (requestToken) {
        credentials = await requestToken(controller.signal);
      } else {
        const res = await fetch(tokenEndpoint, { method: 'POST', signal: controller.signal });
        const body = (await res.json().catch(() => ({}))) as {
          token?: string;
          url?: string;
          error?: string;
        };
        if (!isCurrent()) return;
        if (res.status === 409) {
          setMessage(body.error ?? null);
          setPhase('over');
          return;
        }
        if (!res.ok || !body.token || !body.url) {
          throw new Error(body.error ?? 'Could not open the room — try again.');
        }
        credentials = { token: body.token, url: body.url };
      }
      if (!isCurrent()) return;

      let tracks: LocalTrack[];
      try {
        tracks = await createLocalTracks({ audio: true, video: true });
      } catch {
        throw new Error(
          'Camera or microphone was blocked. Allow access in your browser (the icon near the address bar), then try again.',
        );
      }
      // Device permission can resolve after navigation or a consent change.
      if (!isCurrent()) {
        tracks.forEach((track) => track.stop());
        return;
      }
      tracksRef.current = tracks;

      setPhase('connecting');
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (!isCurrent()) return;
          attachRemote(track);
          setRemotePresent(true);
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => track.detach())
        .on(RoomEvent.ParticipantConnected, () => {
          if (isCurrent()) setRemotePresent(true);
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          if (isCurrent()) setRemotePresent(room.remoteParticipants.size > 0);
        })
        .on(RoomEvent.ConnectionStateChanged, (s) => {
          if (!isCurrent() || roomRef.current !== room) return;
          if (s === ConnectionState.Reconnecting) setPhase('reconnecting');
          if (s === ConnectionState.Connected) setPhase('live');
          if (s === ConnectionState.Disconnected) {
            setPhase('ended');
            // The parent's audio mix must not keep consuming a dead room —
            // on rejoin a fresh Room arrives via onRoom(room) below.
            releaseRoom();
          }
        });

      await room.connect(credentials.url, credentials.token);
      if (!isCurrent() || roomRef.current !== room) {
        void room.disconnect();
        return;
      }
      for (const track of tracks) {
        await room.localParticipant.publishTrack(track);
        if (!isCurrent() || roomRef.current !== room) {
          track.stop();
          void room.disconnect();
          return;
        }
        if (track.kind === Track.Kind.Video && localVideoRef.current) {
          (track as LocalVideoTrack).attach(localVideoRef.current);
        }
      }
      setRemotePresent(room.remoteParticipants.size > 0);
      setMicOn(true);
      setCamOn(true);
      setPhase('live');
      onRoomRef.current?.(room);
    } catch (e) {
      if (!isCurrent()) return;
      setMessage((e as Error).message);
      setPhase('error');
      releaseRoom();
    } finally {
      if (generation === joinGenerationRef.current) joiningRef.current = false;
    }
  }, [tokenEndpoint, requestToken, attachRemote, releaseRoom]);

  // Unmount cleanup reads the latest onRoom through a ref, so the effect can
  // stay mount-only without a lint suppression.
  useEffect(() => {
    return () => {
      joinGenerationRef.current += 1;
      joinRequestRef.current?.abort();
      joiningRef.current = false;
      releaseRoom();
    };
  }, [releaseRoom]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !camOn;
    await room.localParticipant.setCameraEnabled(next);
    setCamOn(next);
  }, [camOn]);

  const leave = useCallback(() => {
    joinGenerationRef.current += 1;
    joinRequestRef.current?.abort();
    joiningRef.current = false;
    releaseRoom();
    if (onLeave) {
      // The parent owns what happens next (e.g. the therapist shell keeps
      // the recorder running and points at End session).
      setPhase('ended');
      onLeave();
      return;
    }
    window.location.href = leaveHref;
  }, [leaveHref, releaseRoom, onLeave]);

  // ---------------------------------------------------------- pre-join --
  if (phase === 'idle' || phase === 'error' || phase === 'requesting-devices') {
    return (
      <div className={`grid ${heightCls} place-items-center bg-[#0a101f] p-6`}>
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center">
          <h1 className="font-serif text-2xl">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
            You&rsquo;ll join {counterpartLabel} in a private room. Your browser will ask for camera
            and microphone access.
          </p>
          {message && (
            <p className="mt-4 rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] px-4 py-3 text-sm text-[var(--color-warn)]">
              {message}
            </p>
          )}
          <button
            type="button"
            onClick={() => void join()}
            disabled={phase === 'requesting-devices'}
            className="mt-6 rounded-full bg-[var(--color-accent)] px-8 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {phase === 'requesting-devices' ? 'Opening…' : message ? 'Try again' : joinLabel}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- over ------
  // The session itself has ended (token route 409) — rejoining can only
  // fail, so don't offer it.
  if (phase === 'over') {
    return (
      <div className={`grid ${heightCls} place-items-center bg-[#0a101f] p-6`}>
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center">
          <h1 className="font-serif text-2xl">Your session has ended</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            {message ?? 'This room is closed now.'} You can close this page.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- ended -----
  if (phase === 'ended') {
    return (
      <div className={`grid ${heightCls} place-items-center bg-[#0a101f] p-6`}>
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center">
          <h1 className="font-serif text-2xl">Call ended</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            You&rsquo;ve left the room. If that wasn&rsquo;t intentional, you can rejoin.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => void join()}
              className="rounded-full bg-[var(--color-accent)] px-6 py-2.5 text-sm font-semibold text-white"
            >
              Rejoin
            </button>
            {onLeave ? (
              <button
                type="button"
                onClick={onLeave}
                className="rounded-full border border-[var(--color-line)] px-6 py-2.5 text-sm font-semibold text-[var(--color-ink-2)]"
              >
                Done
              </button>
            ) : (
              <a
                href={leaveHref}
                className="rounded-full border border-[var(--color-line)] px-6 py-2.5 text-sm font-semibold text-[var(--color-ink-2)]"
              >
                Done
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- in-call ---
  return (
    <div className={`relative flex ${heightCls} flex-col bg-[#0a101f]`}>
      {phase === 'reconnecting' && (
        <div className="absolute inset-x-0 top-0 z-20 bg-[var(--color-warn)] py-2 text-center text-sm font-medium text-white">
          Connection dropped — reconnecting…
        </div>
      )}

      <div className="relative flex-1">
        {/* Remote — fills the frame */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`h-full w-full object-contain ${remotePresent ? '' : 'hidden'}`}
        />
        <audio ref={remoteAudioRef} autoPlay />
        {!remotePresent && (
          <div className="grid h-full w-full place-items-center px-6 text-center">
            <div>
              <div className="mx-auto h-3 w-3 animate-pulse rounded-full bg-white/60" />
              <p className="mt-4 text-lg text-white/90">Waiting for {counterpartLabel}…</p>
              <p className="mt-1 text-sm text-white/50">
                Keep this page open — they&rsquo;ll appear here.
              </p>
            </div>
          </div>
        )}

        {/* Local — corner tile */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-24 right-4 z-10 w-28 rounded-2xl border border-white/20 object-cover shadow-lg sm:w-40"
        />
      </div>

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-4 pb-6 pt-10">
        <button
          type="button"
          onClick={() => void toggleMic()}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          className={`grid h-14 w-14 place-items-center rounded-full text-white transition-colors ${
            micOn ? 'bg-white/15 hover:bg-white/25' : 'bg-[var(--color-warn)]'
          }`}
        >
          {micOn ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 12a6 6 0 0 0 12 0M12 18v3" />
            </svg>
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M12 4a3 3 0 0 1 3 3v5M9 9v3a3 3 0 0 0 5.1 2.1M6 12a6 6 0 0 0 9.7 4.7M18 12a6 6 0 0 1-.4 2.1M12 18v3M4 4l16 16" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={leave}
          aria-label={leaveLabel}
          className="grid h-14 w-14 place-items-center rounded-full bg-[#d0453b] text-white hover:bg-[#b73a31]"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M5 4l14 16M9.5 9.8A11 11 0 0 0 3 12.5l2.2 2.2a1.4 1.4 0 0 0 1.7.2l2.6-1.5M14.8 14.6l2 .9 2.2-2.2A11 11 0 0 0 14 10.8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => void toggleCam()}
          aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
          className={`grid h-14 w-14 place-items-center rounded-full text-white transition-colors ${
            camOn ? 'bg-white/15 hover:bg-white/25' : 'bg-[var(--color-warn)]'
          }`}
        >
          {camOn ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <rect x="3" y="6" width="13" height="12" rx="2.5" />
              <path d="M16 10.5 21 8v8l-5-2.5" />
            </svg>
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <rect x="3" y="6" width="13" height="12" rx="2.5" />
              <path d="M16 10.5 21 8v8l-5-2.5M4 4l16 16" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
