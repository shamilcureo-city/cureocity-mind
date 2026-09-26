import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState, RoomEvent, Track, TrackEvent, type Room } from 'livekit-client';
import { EXTERNAL_AUDIO_INTERRUPTED_EVENT } from './external-live-audio';
import { ScribeCallAudioMixer } from './scribe-call-audio';

class MediaTrack extends EventTarget {
  readyState = 'live';
  enabled = true;
  muted = false;
  kind = 'audio';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}
class Stream extends EventTarget {
  constructor(private tracks: MediaTrack[]) {
    super();
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}
class PublishedAudio extends EventEmitter {
  kind = Track.Kind.Audio;
  isMuted = false;
  isUpstreamPaused = false;
  streamState = Track.StreamState.Active;
  mediaStreamTrack = new MediaTrack();
}
const publication = (track = new PublishedAudio()) => ({ track, isMuted: false });
class CallRoom extends EventEmitter {
  state = ConnectionState.Connected;
  localParticipant = { audioTrackPublications: new Map<string, ReturnType<typeof publication>>() };
  remoteParticipants = new Map<
    string,
    { audioTrackPublications: Map<string, ReturnType<typeof publication>> }
  >();
}
class SourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(readonly stream: Stream) {}
}
class AudioGraph extends EventTarget {
  static instances: AudioGraph[] = [];
  static initialState = 'running';
  static failSource = false;
  static failDestination = false;
  state = AudioGraph.initialState;
  output = new Stream([new MediaTrack()]);
  sources: SourceNode[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  constructor() {
    super();
    AudioGraph.instances.push(this);
  }
  createMediaStreamDestination() {
    if (AudioGraph.failDestination) throw new Error('failed destination');
    return { stream: this.output };
  }
  createMediaStreamSource(stream: Stream) {
    if (AudioGraph.failSource) throw new Error('failed source');
    const node = new SourceNode(stream);
    this.sources.push(node);
    return node;
  }
}
const mixers: ScribeCallAudioMixer[] = [];
function setup(withPatient = true) {
  const room = new CallRoom();
  const local = publication();
  const remote = publication();
  room.localParticipant.audioTrackPublications.set('doctor', local);
  if (withPatient)
    room.remoteParticipants.set('patient', {
      audioTrackPublications: new Map([['patient', remote]]),
    });
  const onState = vi.fn();
  const onInterrupted = vi.fn();
  const mixer = new ScribeCallAudioMixer({ onState, onInterrupted });
  mixers.push(mixer);
  mixer.setRoom(room as unknown as Room);
  return {
    mixer,
    room,
    local,
    remote,
    onState,
    onInterrupted,
    graph: AudioGraph.instances.at(-1)!,
  };
}

beforeEach(() => {
  AudioGraph.instances = [];
  AudioGraph.initialState = 'running';
  AudioGraph.failSource = false;
  AudioGraph.failDestination = false;
  vi.stubGlobal('AudioContext', AudioGraph);
  vi.stubGlobal('MediaStream', Stream);
});
afterEach(() => {
  mixers.splice(0).forEach((mixer) => mixer.dispose());
  vi.unstubAllGlobals();
});

describe('Scribe two-sided call audio mixer', () => {
  it('mixes existing local and remote audio once without taking ownership of the call tracks', () => {
    const { mixer, room, local, remote, graph } = setup();
    expect(mixer.getState()).toMatchObject({
      ready: true,
      localAudioReady: true,
      remoteAudioReady: true,
      error: null,
    });
    expect(graph.sources.map((node) => node.stream.getTracks()[0])).toEqual([
      local.track.mediaStreamTrack,
      remote.track.mediaStreamTrack,
    ]);
    room.emit(RoomEvent.TrackSubscribed);
    expect(graph.sources).toHaveLength(2);
    mixer.dispose();
    expect(graph.sources.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(local.track.mediaStreamTrack.stop).not.toHaveBeenCalled();
    expect(remote.track.mediaStreamTrack.stop).not.toHaveBeenCalled();
    expect(graph.output.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(graph.close).toHaveBeenCalledOnce();
  });

  it('waits for a late patient without recording the doctor alone', () => {
    const { mixer, room, remote, graph } = setup(false);
    expect(mixer.getState()).toMatchObject({
      ready: false,
      localAudioReady: true,
      remoteAudioReady: false,
    });
    expect(graph.sources).toHaveLength(0);
    room.remoteParticipants.set('patient', {
      audioTrackPublications: new Map([['patient', remote]]),
    });
    room.emit(RoomEvent.ParticipantConnected);
    expect(mixer.getState().ready).toBe(true);
    expect(graph.sources).toHaveLength(2);
  });

  it.each(['local', 'remote'] as const)(
    'fails visibly when %s publication is muted and requires no new output stream to recover',
    (side) => {
      const { mixer, room, local, remote, graph, onInterrupted } = setup();
      const output = mixer.getState().stream!;
      const immediate = vi.fn();
      output.addEventListener(EXTERNAL_AUDIO_INTERRUPTED_EVENT, immediate);
      const pub = side === 'local' ? local : remote;
      pub.isMuted = true;
      room.emit(RoomEvent.TrackMuted, pub);
      expect(mixer.getState().ready).toBe(false);
      expect(onInterrupted).toHaveBeenCalledOnce();
      expect(immediate).toHaveBeenCalledOnce();
      expect(
        graph.sources.slice(0, 2).every((node) => node.disconnect.mock.calls.length === 1),
      ).toBe(true);
      expect(pub.track.mediaStreamTrack.stop).not.toHaveBeenCalled();
      pub.isMuted = false;
      room.emit(RoomEvent.TrackUnmuted, pub);
      expect(mixer.getState().ready).toBe(true);
      expect(mixer.getState().stream).toBe(output);
    },
  );

  it.each(['ended', 'mute', 'congestion'] as const)(
    'surfaces remote %s without waiting for a room reconnect',
    (failure) => {
      const { mixer, room, remote, onInterrupted } = setup();
      if (failure === 'congestion') {
        remote.track.streamState = Track.StreamState.Paused;
        room.emit(RoomEvent.TrackStreamStateChanged);
      } else {
        if (failure === 'ended') remote.track.mediaStreamTrack.readyState = 'ended';
        else remote.track.mediaStreamTrack.muted = true;
        remote.track.mediaStreamTrack.dispatchEvent(new Event(failure));
      }
      expect(mixer.getState()).toMatchObject({ ready: false, remoteAudioReady: false });
      expect(onInterrupted).toHaveBeenCalledOnce();
    },
  );

  it.each([
    RoomEvent.TrackUnsubscribed,
    RoomEvent.TrackUnpublished,
    RoomEvent.ParticipantDisconnected,
  ])('disconnects removed remote sources on %s', (event) => {
    const { mixer, room, graph, remote, onInterrupted } = setup();
    room.remoteParticipants.clear();
    room.emit(event);
    expect(mixer.getState().ready).toBe(false);
    expect(graph.sources[1].disconnect).toHaveBeenCalledOnce();
    expect(remote.track.listenerCount(TrackEvent.Restarted)).toBe(0);
    expect(onInterrupted).toHaveBeenCalledOnce();
  });

  it('handles local unpublish and a replacement physical track on the same LiveKit track', () => {
    const { mixer, room, graph, local, onInterrupted } = setup();
    const original = local.track.mediaStreamTrack;
    const output = mixer.getState().stream;
    local.track.mediaStreamTrack = new MediaTrack();
    local.track.emit(TrackEvent.Restarted);
    expect(graph.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(graph.sources.at(-1)?.stream.getTracks()[0]).toBe(local.track.mediaStreamTrack);
    expect(mixer.getState().ready).toBe(true);
    expect(mixer.getState().stream).toBe(output);
    expect(onInterrupted).toHaveBeenCalledOnce();
    original.dispatchEvent(new Event('ended'));
    expect(onInterrupted).toHaveBeenCalledOnce();
    room.localParticipant.audioTrackPublications.clear();
    room.emit(RoomEvent.LocalTrackUnpublished);
    expect(mixer.getState().localAudioReady).toBe(false);
    expect(onInterrupted).toHaveBeenCalledTimes(2);
  });

  it('does not capture a locally paused publication even if its physical microphone remains live', () => {
    const { mixer, local, onInterrupted } = setup();
    local.track.isUpstreamPaused = true;
    local.track.emit(TrackEvent.UpstreamPaused);
    expect(mixer.getState()).toMatchObject({ ready: false, localAudioReady: false });
    expect(local.track.mediaStreamTrack.readyState).toBe('live');
    expect(onInterrupted).toHaveBeenCalledOnce();
    local.track.isUpstreamPaused = false;
    local.track.emit(TrackEvent.UpstreamResumed);
    expect(mixer.getState().ready).toBe(true);
  });

  it('retains its destination across reconnect, null-room gap and a new-room rejoin; old room events are detached', () => {
    const { mixer, room, graph, onInterrupted } = setup();
    const output = mixer.getState().stream;
    room.state = ConnectionState.Reconnecting;
    room.emit(RoomEvent.ConnectionStateChanged, room.state);
    expect(mixer.getState().ready).toBe(false);
    room.state = ConnectionState.Connected;
    room.emit(RoomEvent.Reconnected);
    expect(mixer.getState().ready).toBe(true);
    mixer.setRoom(null);
    expect(room.eventNames()).toHaveLength(0);
    const replacement = new CallRoom();
    replacement.localParticipant.audioTrackPublications.set('doctor', publication());
    replacement.remoteParticipants.set('patient', {
      audioTrackPublications: new Map([['patient', publication()]]),
    });
    mixer.setRoom(replacement as unknown as Room);
    expect(mixer.getState().stream).toBe(output);
    expect(AudioGraph.instances).toHaveLength(1);
    expect(graph.output.getTracks()[0].stop).not.toHaveBeenCalled();
    expect(mixer.getState().ready).toBe(true);
    expect(onInterrupted).toHaveBeenCalledTimes(2);
    room.state = ConnectionState.Disconnected;
    room.emit(RoomEvent.Disconnected);
    expect(mixer.getState().ready).toBe(true);
  });

  it('suspends readiness with the audio context and recovers only on a successful resume', async () => {
    const { mixer, graph, onInterrupted } = setup();
    graph.state = 'suspended';
    graph.dispatchEvent(new Event('statechange'));
    expect(mixer.getState().ready).toBe(false);
    expect(onInterrupted).toHaveBeenCalledOnce();
    graph.resume.mockRejectedValueOnce(new Error('blocked'));
    await expect(mixer.resume()).rejects.toThrow('blocked');
    expect(mixer.getState().error).toContain('could not resume');
    await mixer.resume();
    expect(mixer.getState().ready).toBe(true);
  });

  it('fails closed when graph setup or source connection fails, then allows explicit retry', async () => {
    AudioGraph.failDestination = true;
    const { mixer } = setup();
    expect(mixer.getState()).toMatchObject({ ready: false, stream: null });
    expect(AudioGraph.instances[0].close).toHaveBeenCalledOnce();
    AudioGraph.failDestination = false;
    AudioGraph.failSource = true;
    await mixer.resume();
    expect(mixer.getState().ready).toBe(false);
    expect(mixer.getState().error).toContain('could not be connected');
    AudioGraph.failSource = false;
    await mixer.resume();
    expect(mixer.getState().ready).toBe(true);
  });

  it('rebuilds all source nodes on explicit retry after a browser closes the old context', async () => {
    const { mixer, graph, local, remote, onInterrupted } = setup();
    const originalStream = mixer.getState().stream;
    graph.state = 'closed';
    graph.dispatchEvent(new Event('statechange'));
    expect(mixer.getState().ready).toBe(false);
    expect(onInterrupted).toHaveBeenCalledOnce();
    await mixer.resume();
    const replacement = AudioGraph.instances.at(-1)!;
    expect(replacement).not.toBe(graph);
    expect(replacement.sources).toHaveLength(2);
    expect(mixer.getState().stream).not.toBe(originalStream);
    expect(mixer.getState().ready).toBe(true);
    expect(local.track.mediaStreamTrack.stop).not.toHaveBeenCalled();
    expect(remote.track.mediaStreamTrack.stop).not.toHaveBeenCalled();
  });

  it('does not publish late state after disposal during context resume', async () => {
    AudioGraph.initialState = 'suspended';
    const { mixer, graph, room, local, onState } = setup();
    let resolve!: () => void;
    graph.resume.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const pending = mixer.resume();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    mixer.dispose();
    const stateCount = onState.mock.calls.length;
    resolve();
    await rejected;
    expect(onState).toHaveBeenCalledTimes(stateCount);
    expect(room.eventNames()).toHaveLength(0);
    expect(local.track.eventNames()).toHaveLength(0);
    expect(local.track.mediaStreamTrack.stop).not.toHaveBeenCalled();
    await expect(mixer.resume()).rejects.toThrow('no longer available');
  });

  it('does not let a pending old-room resume clear a new-room failure', async () => {
    AudioGraph.initialState = 'suspended';
    const { mixer, graph } = setup();
    let resolve!: () => void;
    graph.resume.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const pending = mixer.resume();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    const replacement = new CallRoom();
    mixer.setRoom(replacement as unknown as Room);
    replacement.emit(RoomEvent.TrackSubscriptionFailed);
    const failed = mixer.getState();
    resolve();
    await rejected;
    expect(mixer.getState()).toBe(failed);
    expect(mixer.getState().error).toContain('could not be subscribed');
  });
});
