import {
  ConnectionState,
  RoomEvent,
  Track,
  TrackEvent,
  type Room,
  type TrackPublication,
} from 'livekit-client';
import { closeDetachedAudioContext } from './live-stream-cleanup';
import { EXTERNAL_AUDIO_INTERRUPTED_EVENT } from './external-live-audio';

export interface ScribeCallAudioState {
  stream: MediaStream | null;
  ready: boolean;
  localAudioReady: boolean;
  remoteAudioReady: boolean;
  connectionState: ConnectionState;
  error: string | null;
}

export const EMPTY_SCRIBE_CALL_AUDIO: ScribeCallAudioState = {
  stream: null,
  ready: false,
  localAudioReady: false,
  remoteAudioReady: false,
  connectionState: ConnectionState.Disconnected,
  error: 'Join the call before preparing its audio.',
};

type Source = { node: MediaStreamAudioSourceNode; local: boolean };
type PublishedTrack = { publication: TrackPublication; local: boolean };

/**
 * One stable destination across room reconnects/rejoins. Call tracks are borrowed,
 * never cloned/stopped here. Only source nodes, listeners and our destination belong
 * to this mixer. Readiness requires both sides of this 1:1 call, not sound amplitude.
 */
export class ScribeCallAudioMixer {
  private room: Room | null = null;
  private context: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<MediaStreamTrack, Source>();
  private trackListeners = new Map<Track, () => void>();
  private mediaListeners = new Map<MediaStreamTrack, () => void>();
  private roomListeners: Array<() => void> = [];
  private disposed = false;
  private roomRevision = 0;
  private graphError: string | null = null;
  private state: ScribeCallAudioState = { ...EMPTY_SCRIBE_CALL_AUDIO };

  constructor(
    private callbacks: {
      onState: (state: ScribeCallAudioState) => void;
      onInterrupted?: (message: string) => void;
    },
  ) {}

  getState(): ScribeCallAudioState {
    return this.state;
  }

  setRoom(room: Room | null): void {
    if (this.disposed) return;
    if (room === this.room) {
      this.reconcile();
      return;
    }
    ++this.roomRevision;
    // A new room can already contain both tracks, but continuity across the hop
    // is unproven: interrupt before attaching it. Resuming recording is explicit.
    this.publish({
      ...this.state,
      ready: false,
      error: 'The call connection changed. Check both sides before resuming recording.',
    });
    this.detachRoom();
    this.room = room;
    if (room) {
      try {
        this.ensureGraph();
      } catch {
        this.graphError = 'Call audio could not be prepared. Retry audio before recording.';
      }
      const refresh = () => this.reconcile();
      const events = [
        RoomEvent.ConnectionStateChanged,
        RoomEvent.Reconnecting,
        RoomEvent.SignalReconnecting,
        RoomEvent.Reconnected,
        RoomEvent.Disconnected,
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.TrackStreamStateChanged,
        RoomEvent.TrackSubscriptionPermissionChanged,
        RoomEvent.TrackSubscriptionStatusChanged,
        RoomEvent.MediaDevicesChanged,
      ] as const;
      for (const event of events) {
        room.on(event, refresh);
        this.roomListeners.push(() => room.off(event, refresh));
      }
      const subscriptionFailed = () => {
        this.disconnectSources();
        this.graphError =
          'Patient call audio could not be subscribed. Rejoin the call before recording.';
        this.reconcile();
      };
      room.on(RoomEvent.TrackSubscriptionFailed, subscriptionFailed);
      this.roomListeners.push(() =>
        room.off(RoomEvent.TrackSubscriptionFailed, subscriptionFailed),
      );
    }
    this.reconcile();
  }

  /** Can be called by a user gesture when a browser suspends its audio context. */
  async resume(): Promise<void> {
    if (this.disposed) throw new Error('Call audio is no longer available.');
    if (!this.room) throw new Error('Join the call before preparing its audio.');
    const roomRevision = this.roomRevision;
    try {
      this.ensureGraph();
      const context = this.context!;
      if (context.state !== 'running') await context.resume();
      if (this.disposed || context !== this.context || roomRevision !== this.roomRevision)
        throw new Error('Call audio preparation was cancelled.');
      if (context.state !== 'running')
        throw new Error('Call audio is suspended. Retry audio from this tab.');
      this.graphError = null;
      this.reconcile();
    } catch (error) {
      if (!this.disposed && roomRevision === this.roomRevision) {
        this.graphError =
          'Call audio could not resume. Rejoin the call or retry audio before recording.';
        this.reconcile();
      }
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachRoom();
    this.room = null;
    this.destination?.stream.getTracks().forEach((track) => track.stop());
    this.destination = null;
    if (this.context) {
      this.context.removeEventListener('statechange', this.onContextState);
      void closeDetachedAudioContext(this.context);
      this.context = null;
    }
  }

  private ensureGraph(): void {
    if (this.context?.state === 'closed') {
      this.disconnectSources();
      this.context.removeEventListener('statechange', this.onContextState);
      this.destination?.stream.getTracks().forEach((track) => track.stop());
      this.destination = null;
      this.context = null;
    }
    if (this.context && this.destination) return;
    const context = new AudioContext({ sampleRate: 48_000 });
    try {
      this.destination = context.createMediaStreamDestination();
      this.context = context;
      context.addEventListener('statechange', this.onContextState);
      this.graphError = null;
    } catch (error) {
      void closeDetachedAudioContext(context);
      throw error;
    }
  }

  private onContextState = () => this.reconcile();

  private publications(): PublishedTrack[] {
    if (!this.room) return [];
    return [
      ...Array.from(this.room.localParticipant.audioTrackPublications.values(), (publication) => ({
        publication,
        local: true,
      })),
      ...Array.from(this.room.remoteParticipants.values()).flatMap((participant) =>
        Array.from(participant.audioTrackPublications.values(), (publication) => ({
          publication,
          local: false,
        })),
      ),
    ];
  }

  private reconcile(): void {
    if (this.disposed) return;
    const publications = this.publications();
    this.syncTrackListeners(publications);
    const available = publications.filter(({ publication }) => {
      const track = publication.track;
      const media = track?.mediaStreamTrack;
      return (
        track?.kind === Track.Kind.Audio &&
        !publication.isMuted &&
        publication.isSubscribed !== false &&
        !track.isMuted &&
        !('isUpstreamPaused' in track && track.isUpstreamPaused === true) &&
        track.streamState !== Track.StreamState.Paused &&
        media?.readyState === 'live' &&
        media.enabled &&
        !media.muted
      );
    });
    const localAudioReady = available.some(({ local }) => local);
    const remoteAudioReady = available.some(({ local }) => !local);
    const connectionState = this.room?.state ?? ConnectionState.Disconnected;
    const graphReady =
      connectionState === ConnectionState.Connected &&
      this.context?.state === 'running' &&
      !this.graphError;
    const desired = new Map<MediaStreamTrack, boolean>();
    // Do not record one party while the other side is unavailable.
    if (graphReady && localAudioReady && remoteAudioReady) {
      for (const { publication, local } of available)
        desired.set(publication.track!.mediaStreamTrack, local);
    }
    const replaced =
      this.state.ready && [...this.sources.keys()].some((track) => !desired.has(track));
    for (const [track, source] of this.sources) {
      if (desired.has(track)) continue;
      source.node.disconnect();
      this.sources.delete(track);
    }
    if (replaced)
      this.publish({
        ...this.state,
        ready: false,
        error:
          'Call audio was interrupted or changed. Check both sides and resume recording explicitly.',
      });
    try {
      for (const [track, local] of desired) {
        if (this.sources.has(track)) continue;
        const node = this.context!.createMediaStreamSource(new MediaStream([track]));
        try {
          node.connect(this.destination!);
          this.sources.set(track, { node, local });
        } catch (error) {
          node.disconnect();
          throw error;
        }
      }
    } catch {
      this.disconnectSources();
      this.graphError =
        'Call audio could not be connected to the recorder. Retry audio before recording.';
    }
    const error =
      this.graphError ??
      (!this.room
        ? 'Join the call before preparing its audio.'
        : connectionState !== ConnectionState.Connected
          ? 'The call is disconnected or reconnecting. Recording must wait.'
          : this.context?.state !== 'running'
            ? 'Call audio is suspended. Retry audio from this tab.'
            : !localAudioReady
              ? 'Doctor microphone is unavailable or muted. Unmute before recording.'
              : !remoteAudioReady
                ? 'Patient audio is unavailable or muted. Wait for the patient to join and unmute.'
                : null);
    this.publish({
      stream: this.destination?.stream ?? null,
      ready: !error && this.sources.size >= 2,
      localAudioReady,
      remoteAudioReady,
      connectionState,
      error,
    });
  }

  private syncTrackListeners(publications: PublishedTrack[]): void {
    const tracks = new Set(
      publications.flatMap(({ publication }) => (publication.track ? [publication.track] : [])),
    );
    const media = new Set([...tracks].map((track) => track.mediaStreamTrack));
    for (const [track, cleanup] of this.trackListeners) {
      if (!tracks.has(track)) {
        cleanup();
        this.trackListeners.delete(track);
      }
    }
    for (const [track, cleanup] of this.mediaListeners) {
      if (!media.has(track)) {
        cleanup();
        this.mediaListeners.delete(track);
      }
    }
    for (const track of tracks) {
      if (this.trackListeners.has(track)) continue;
      const refresh = () => this.reconcile();
      const events = [
        TrackEvent.Restarted,
        TrackEvent.Ended,
        TrackEvent.Muted,
        TrackEvent.Unmuted,
        TrackEvent.UpstreamPaused,
        TrackEvent.UpstreamResumed,
        TrackEvent.TrackProcessorUpdate,
      ] as const;
      events.forEach((event) => track.on(event, refresh));
      this.trackListeners.set(track, () => events.forEach((event) => track.off(event, refresh)));
    }
    for (const track of media) {
      if (this.mediaListeners.has(track)) continue;
      const refresh = () => this.reconcile();
      const events = ['ended', 'mute', 'unmute'];
      events.forEach((event) => track.addEventListener(event, refresh));
      this.mediaListeners.set(track, () =>
        events.forEach((event) => track.removeEventListener(event, refresh)),
      );
    }
  }

  private disconnectSources(): void {
    this.sources.forEach(({ node }) => node.disconnect());
    this.sources.clear();
  }

  private detachRoom(): void {
    this.roomListeners.splice(0).forEach((cleanup) => cleanup());
    this.trackListeners.forEach((cleanup) => cleanup());
    this.trackListeners.clear();
    this.mediaListeners.forEach((cleanup) => cleanup());
    this.mediaListeners.clear();
    this.disconnectSources();
    this.graphError = null;
  }

  private publish(next: ScribeCallAudioState): void {
    const wasReady = this.state.ready;
    const changed = Object.keys(next).some(
      (key) =>
        next[key as keyof ScribeCallAudioState] !== this.state[key as keyof ScribeCallAudioState],
    );
    this.state = next;
    if (wasReady && !next.ready) {
      // The destination itself stays live during gaps. Notify its consumer now,
      // rather than waiting for a rendered readiness prop or recording silence.
      next.stream?.dispatchEvent(new Event(EXTERNAL_AUDIO_INTERRUPTED_EVENT));
      this.callbacks.onInterrupted?.(next.error ?? 'Call audio was interrupted.');
    }
    if (changed) this.callbacks.onState(next);
  }
}
