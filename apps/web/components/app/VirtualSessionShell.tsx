'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 * The mix follows the room live: tracks that join later (client reconnects)
 * are added as they arrive, and mic mute silences the mix naturally because
 * LiveKit disables the underlying track.
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
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mixedStream, setMixedStream] = useState<MediaStream | null>(null);

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

  const attachTrack = useCallback((mediaTrack: MediaStreamTrack | undefined) => {
    const ctx = audioCtxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest || !mediaTrack) return;
    if (attachedTrackIds.current.has(mediaTrack.id)) return;
    attachedTrackIds.current.add(mediaTrack.id);
    const source = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
    source.connect(dest);
  }, []);

  const onRoom = useCallback(
    (room: Room | null) => {
      if (!room) {
        setMixedStream(null);
        attachedTrackIds.current.clear();
        void audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        destRef.current = null;
        return;
      }
      const ctx = new AudioContext({ sampleRate: 48_000 });
      const dest = ctx.createMediaStreamDestination();
      audioCtxRef.current = ctx;
      destRef.current = dest;

      // Everything already in the room…
      for (const pub of room.localParticipant.audioTrackPublications.values()) {
        attachTrack(pub.track?.mediaStreamTrack);
      }
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.audioTrackPublications.values()) {
          attachTrack(pub.track?.mediaStreamTrack);
        }
      }
      // …and everything that arrives later.
      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.kind === Track.Kind.Audio) attachTrack(pub.track?.mediaStreamTrack);
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) attachTrack(track.mediaStreamTrack);
      });

      setMixedStream(dest.stream);
    },
    [attachTrack],
  );

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
          leaveHref={`/app/sessions/${sessionId}?tab=copilot`}
          chrome="embedded"
          onRoom={onRoom}
        />
      </div>

      {/* The scribe — same pipeline as walk-in, fed the mixed call audio. */}
      {mixedStream ? (
        <LiveRecorder
          sessionId={sessionId}
          clientId={clientId}
          clientName={clientName}
          modality={modality}
          source="external"
          externalStream={mixedStream}
          reviewHref={`/app/sessions/${sessionId}?tab=copilot`}
          onFinished={() => {}}
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
