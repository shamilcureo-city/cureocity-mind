import { closeDetachedAudioContext } from '@/lib/audio/live-stream-cleanup';

export type SourceCheckMode =
  | 'default'
  | 'scribe'
  | 'context'
  | 'silent-context'
  | 'native-context';
export type SourceCheckEvent = {
  mode: SourceCheckMode;
  input: 'default' | 'selected';
  phase:
    | 'requesting'
    | 'live'
    | 'context-starting'
    | 'context-created'
    | 'context-running'
    | 'mute'
    | 'unmute'
    | 'ended'
    | 'complete'
    | 'cancelled'
    | 'timeout'
    | 'unsupported'
    | 'unavailable';
  elapsedMs: number;
  state?: MediaStreamTrackState;
  muted?: boolean;
  enabled?: boolean;
  contextState?: AudioContextState;
  contextSampleRate?: number;
  constructorMs?: number;
  captureElapsedMs?: number;
  deadlineExceeded?: boolean;
};

type SilentContextOptions = AudioContextOptions & { sinkId: { type: 'none' } };
type SilentContext = AudioContext & { readonly sinkId?: string | { type?: string } };

/** Development-only isolation. No audio nodes, sample reader, storage or upload. */
export function checkMicrophoneSource({
  signal,
  onEvent,
  mode = 'default',
  deviceId,
}: {
  signal: AbortSignal;
  onEvent: (event: SourceCheckEvent) => void;
  mode?: SourceCheckMode;
  deviceId?: string;
}): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let stream: MediaStream | undefined;
    let track: MediaStreamTrack | undefined;
    let context: AudioContext | undefined;
    let constructorMs: number | undefined;
    let grantedAt: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const withContext =
      mode === 'context' || mode === 'silent-context' || mode === 'native-context';
    const scribePreferences = mode !== 'default';
    const removers: Array<() => void> = [];
    const captureDeadlineExceeded = () =>
      grantedAt !== undefined && Date.now() - grantedAt >= 8_000;
    const trackHasEnded = (): boolean => track?.readyState === 'ended';
    const emit = (phase: SourceCheckEvent['phase']) => {
      try {
        onEvent({
          mode,
          input: deviceId ? 'selected' : 'default',
          phase,
          elapsedMs: Date.now() - started,
          ...(track ? { state: track.readyState, muted: track.muted, enabled: track.enabled } : {}),
          ...(context
            ? { contextState: context.state, contextSampleRate: context.sampleRate }
            : {}),
          ...(constructorMs !== undefined ? { constructorMs } : {}),
          ...(grantedAt !== undefined
            ? {
                captureElapsedMs: Date.now() - grantedAt,
                deadlineExceeded: captureDeadlineExceeded(),
              }
            : {}),
        });
      } catch {
        /* UI callbacks must not prevent microphone release. */
      }
    };
    const release = (media: MediaStream) =>
      media.getTracks().forEach((item) => {
        try {
          item.stop();
        } catch {
          /* Continue releasing remaining tracks. */
        }
      });
    const finish = (phase: SourceCheckEvent['phase']) => {
      if (settled) return;
      // A completion timer may be the first delayed task to run after a main-
      // thread stall. Never let it erase an already-exceeded capture deadline.
      // Real interruption events retain their reason, with deadline metadata.
      if (phase === 'complete') {
        if (track?.readyState === 'ended') phase = 'ended';
        else if (captureDeadlineExceeded()) phase = 'timeout';
        else if (
          track?.muted ||
          track?.enabled === false ||
          (withContext && context?.state !== 'running')
        )
          phase = 'unavailable';
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(holdTimer);
      removers.splice(0).forEach((remove) => remove());
      emit(phase);
      // Stop physical capture before context.close, which browsers may delay.
      if (stream) release(stream);
      void (context ? closeDetachedAudioContext(context) : Promise.resolve()).then(resolve);
    };
    const listen = (target: EventTarget, name: string, callback: () => void) => {
      target.addEventListener(name, callback);
      removers.push(() => target.removeEventListener(name, callback));
    };
    if (signal.aborted) {
      finish('cancelled');
      return;
    }
    if (
      withContext &&
      (typeof AudioContext === 'undefined' ||
        (mode === 'silent-context' &&
          typeof (AudioContext.prototype as AudioContext & { setSinkId?: unknown }).setSinkId !==
            'function'))
    ) {
      finish('unsupported');
      return;
    }
    listen(signal, 'abort', () => finish('cancelled'));
    if (typeof document !== 'undefined') {
      if (document.visibilityState === 'hidden') {
        finish('cancelled');
        return;
      }
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') finish('cancelled');
      });
    }
    if (typeof window !== 'undefined') listen(window, 'pagehide', () => finish('cancelled'));
    timer = setTimeout(() => finish('timeout'), 30_000);
    emit('requesting');
    if (settled) return;
    try {
      void navigator.mediaDevices
        .getUserMedia({
          audio:
            scribePreferences || deviceId
              ? {
                  ...(scribePreferences
                    ? {
                        sampleRate: 48_000,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                      }
                    : {}),
                  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
                }
              : true,
          video: false,
        })
        .then((media) => {
          if (settled) {
            release(media);
            return;
          }
          stream = media;
          track = media.getAudioTracks()[0];
          if (Date.now() - started >= 30_000) {
            // A late grant can beat a delayed permission-timeout callback.
            finish('timeout');
            return;
          }
          if (!track) {
            finish('unavailable');
            return;
          }
          grantedAt = Date.now();
          if (track.readyState === 'ended') {
            finish('ended');
            return;
          }
          clearTimeout(timer);
          // Context setup and the three-second running observation share one
          // eight-second capture deadline. Source-only modes remain three seconds.
          timer = setTimeout(
            () => finish(withContext ? 'timeout' : 'complete'),
            withContext ? 8_000 : 3_000,
          );
          listen(track, 'ended', () => finish('ended'));
          listen(track, 'mute', () => emit('mute'));
          listen(track, 'unmute', () => emit('unmute'));
          emit('live');
          if (!withContext || settled) return;
          emit('context-starting');
          if (settled) return;
          const options: AudioContextOptions | SilentContextOptions =
            mode === 'silent-context'
              ? { sampleRate: 48_000, sinkId: { type: 'none' } }
              : { sampleRate: 48_000 };
          // The context has no nodes: the microphone is never connected to an
          // output, a worklet or a sample reader, even in the normal-output mode.
          const constructorStarted = Date.now();
          const created =
            mode === 'native-context' ? new AudioContext() : new AudioContext(options);
          constructorMs = Math.max(0, Date.now() - constructorStarted);
          if (settled) {
            // A synchronous constructor can trigger a track-ended/abort callback.
            void closeDetachedAudioContext(created);
            return;
          }
          context = created;
          emit('context-created');
          if (settled) return;
          // Re-read native state: the constructor may have outlived the track.
          if (trackHasEnded()) {
            finish('ended');
            return;
          }
          if (captureDeadlineExceeded()) {
            // Timers cannot interrupt a synchronous native constructor. Check
            // elapsed time as soon as it returns, before reporting readiness.
            finish('timeout');
            return;
          }
          if (mode === 'silent-context') {
            const sink = (created as SilentContext).sinkId;
            if (!sink || typeof sink !== 'object' || sink.type !== 'none') {
              // Do not silently test the normal output if the option was ignored.
              finish('unsupported');
              return;
            }
          }
          const observeContext = () => {
            if (settled) return;
            if (track?.readyState === 'ended') {
              finish('ended');
            } else if (captureDeadlineExceeded()) {
              finish('timeout');
            } else if (created.state === 'closed' || (holdTimer && created.state !== 'running')) {
              finish('unavailable');
            } else if (created.state === 'running' && !holdTimer) {
              emit('context-running');
              if (!settled) holdTimer = setTimeout(() => finish('complete'), 3_000);
            }
          };
          listen(created, 'statechange', observeContext);
          observeContext();
          if (settled) return;
          void created.resume().then(observeContext, () => finish('unavailable'));
        })
        .catch(() => finish('unavailable'));
    } catch {
      finish('unavailable');
    }
  });
}
