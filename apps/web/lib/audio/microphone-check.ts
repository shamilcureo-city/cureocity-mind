import { closeDetachedAudioContext } from './live-stream-cleanup';

type MicrophoneCheckErrorCode =
  | 'permission-denied'
  | 'missing'
  | 'unavailable'
  | 'ended'
  | 'muted'
  | 'no-frames'
  | 'timeout'
  | 'unsupported'
  | 'cancelled';

export class MicrophoneCheckError extends Error {
  constructor(
    public readonly code: MicrophoneCheckErrorCode,
    message = 'Microphone check did not complete.',
  ) {
    super(message);
    this.name = 'MicrophoneCheckError';
  }
}

export type MicrophoneCheckProgress = {
  stage: 'requesting' | 'checking';
  level: number;
  frames: number;
  device: { deviceId: string; label: string } | null;
};

export type MicrophoneCheckResult = {
  deviceId: string;
  label: string;
  heardSound: boolean;
};

const STABLE_SECONDS = 3;
const CHECK_TIMEOUT_MS = 8_000;
const PERMISSION_TIMEOUT_MS = 30_000;

function captureError(error: unknown): MicrophoneCheckError {
  if (error instanceof MicrophoneCheckError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MicrophoneCheckError('permission-denied', 'Microphone permission was not granted.');
  }
  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError'
  ) {
    return new MicrophoneCheckError('missing', 'The selected microphone is not available.');
  }
  return new MicrophoneCheckError('unavailable', 'The browser could not open the microphone.');
}

/**
 * Explicit, local-only preflight. Call directly from a user click: getUserMedia
 * is requested synchronously, before awaiting anything. No audio samples leave
 * the worklet; only scalar level/frame metadata reaches this controller.
 */
export function checkMicrophone({
  deviceId,
  signal,
  onProgress,
}: {
  deviceId?: string;
  signal: AbortSignal;
  onProgress: (progress: MicrophoneCheckProgress) => void;
}): Promise<MicrophoneCheckResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream: MediaStream | undefined;
    let track: MediaStreamTrack | undefined;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let worklet: AudioWorkletNode | undefined;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let epoch = 0;
    let stableFrames = 0;
    let totalFrames = 0;
    let stableSince = 0;
    let heardSound = false;
    let device: MicrophoneCheckProgress['device'] = null;
    const listeners: Array<() => void> = [];

    const stopTracks = (ownedStream: MediaStream) => {
      ownedStream.getTracks().forEach((ownedTrack) => {
        try {
          ownedTrack.stop();
        } catch {
          /* Continue releasing other tracks. */
        }
      });
    };
    const listen = (target: EventTarget, name: string, callback: EventListener) => {
      target.addEventListener(name, callback);
      listeners.push(() => target.removeEventListener(name, callback));
    };
    const progress = (stage: MicrophoneCheckProgress['stage'], level = 0) => {
      if (settled) return;
      try {
        onProgress({ stage, level, frames: totalFrames, device });
      } catch {
        // A UI callback must never prevent the automatic microphone release.
      }
    };
    const finish = (error?: MicrophoneCheckError, result?: MicrophoneCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listeners.splice(0).forEach((remove) => remove());
      // Release the physical microphone first, even if context.close hangs.
      if (stream) stopTracks(stream);
      if (worklet) {
        worklet.port.onmessage = null;
        worklet.onprocessorerror = null;
        try {
          worklet.port.postMessage({ type: 'stop' });
        } catch {
          /* Already detached. */
        }
        try {
          worklet.port.close();
        } catch {
          /* Already detached. */
        }
      }
      try {
        source?.disconnect();
      } catch {
        /* Already disconnected. */
      }
      try {
        worklet?.disconnect();
      } catch {
        /* Already disconnected. */
      }
      const closing = context ? closeDetachedAudioContext(context) : Promise.resolve();
      void closing.then(() => (error ? reject(error) : resolve(result!)));
    };
    const cancel = () =>
      finish(new MicrophoneCheckError('cancelled', 'Microphone check cancelled.'));
    const unavailable = () =>
      finish(
        new MicrophoneCheckError('unavailable', 'Audio capture was interrupted by the browser.'),
      );
    const deadline = () => {
      if (track?.readyState === 'ended') {
        finish(new MicrophoneCheckError('ended', 'The microphone stopped during its check.'));
      } else if (track?.muted || track?.enabled === false) {
        finish(
          new MicrophoneCheckError(
            'muted',
            'The microphone remained unavailable during its check.',
          ),
        );
      } else if (totalFrames === 0) {
        finish(
          new MicrophoneCheckError(
            'no-frames',
            'The microphone opened but supplied no audio frames.',
          ),
        );
      } else {
        finish(
          new MicrophoneCheckError('timeout', 'The microphone did not stay ready long enough.'),
        );
      }
    };
    const resetStability = () => {
      epoch += 1;
      stableFrames = 0;
      stableSince = Date.now();
      worklet?.port.postMessage({ type: 'reset', epoch });
    };
    const connectIfReady = () => {
      if (settled || !source || !worklet || !track || context?.state !== 'running') return;
      if (track.readyState === 'ended') {
        finish(new MicrophoneCheckError('ended', 'The microphone stopped during its check.'));
        return;
      }
      if (track.muted || !track.enabled || connected) return;
      try {
        resetStability();
        source.connect(worklet);
        connected = true;
      } catch {
        unavailable();
      }
    };

    if (signal.aborted) {
      cancel();
      return;
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined' ||
      typeof AudioWorkletNode === 'undefined'
    ) {
      finish(
        new MicrophoneCheckError('unsupported', 'This browser cannot run the microphone check.'),
      );
      return;
    }
    listen(signal, 'abort', cancel);
    if (typeof document !== 'undefined') {
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') cancel();
      });
      if (document.visibilityState === 'hidden') {
        cancel();
        return;
      }
    }
    if (typeof window !== 'undefined') listen(window, 'pagehide', cancel);
    timer = setTimeout(
      () =>
        finish(
          new MicrophoneCheckError(
            'timeout',
            'Microphone permission was not completed in time. Try again when ready.',
          ),
        ),
      PERMISSION_TIMEOUT_MS,
    );
    progress('requesting');
    if (settled) return;

    let request: Promise<MediaStream>;
    try {
      request = navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48_000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        video: false,
      });
    } catch (error) {
      finish(captureError(error));
      return;
    }

    void request
      .then(async (acquired) => {
        if (settled) {
          stopTracks(acquired);
          return;
        }
        stream = acquired;
        clearTimeout(timer);
        timer = setTimeout(deadline, CHECK_TIMEOUT_MS);
        track = acquired.getAudioTracks()[0];
        if (!track) {
          finish(new MicrophoneCheckError('missing', 'No microphone audio track was supplied.'));
          return;
        }
        if (track.readyState === 'ended') {
          finish(
            new MicrophoneCheckError('ended', 'The microphone stopped before its check began.'),
          );
          return;
        }
        device = {
          deviceId: track.getSettings().deviceId ?? deviceId ?? '',
          label: track.label || 'Microphone',
        };
        listen(track, 'ended', () =>
          finish(new MicrophoneCheckError('ended', 'The microphone stopped during its check.')),
        );
        listen(track, 'mute', () => {
          if (settled) return;
          try {
            resetStability();
            if (connected) {
              source?.disconnect();
              connected = false;
            }
          } catch {
            unavailable();
          }
          progress('checking');
        });
        listen(track, 'unmute', connectIfReady);
        progress('checking');
        if (settled) return;

        context = new AudioContext({ sampleRate: 48_000 });
        if (!context.audioWorklet) {
          finish(
            new MicrophoneCheckError(
              'unsupported',
              'This browser cannot run the microphone check.',
            ),
          );
          return;
        }
        await context.audioWorklet.addModule('/microphone-check-worklet.js');
        if (settled) return;
        if (context.state !== 'running') await context.resume();
        if (settled) return;
        if (context.state !== 'running') {
          unavailable();
          return;
        }
        listen(context, 'statechange', () => {
          if (context?.state !== 'running') unavailable();
        });
        source = context.createMediaStreamSource(acquired);
        worklet = new AudioWorkletNode(context, 'cureocity-microphone-check', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        worklet.onprocessorerror = unavailable;
        worklet.port.onmessage = (event: MessageEvent) => {
          if (settled) return;
          const data: unknown = event.data;
          if (!data || typeof data !== 'object' || !('type' in data)) return;
          if (data.type === 'limit') {
            deadline();
            return;
          }
          if (
            data.type !== 'meter' ||
            !('epoch' in data) ||
            data.epoch !== epoch ||
            !('frames' in data) ||
            typeof data.frames !== 'number' ||
            !Number.isSafeInteger(data.frames) ||
            data.frames <= stableFrames ||
            !('rms' in data) ||
            typeof data.rms !== 'number' ||
            !Number.isFinite(data.rms) ||
            !('peak' in data) ||
            typeof data.peak !== 'number' ||
            !Number.isFinite(data.peak)
          )
            return;
          if (
            !connected ||
            track?.readyState !== 'live' ||
            track.muted ||
            !track.enabled ||
            context?.state !== 'running'
          )
            return;
          totalFrames += data.frames - stableFrames;
          stableFrames = data.frames;
          const level = Math.max(0, Math.min(1, data.rms));
          heardSound ||= data.peak > 0.01;
          progress('checking', level);
          if (
            stableFrames >= context.sampleRate * STABLE_SECONDS &&
            Date.now() - stableSince >= STABLE_SECONDS * 1_000
          ) {
            finish(undefined, { ...device!, heardSound });
          }
        };
        worklet.connect(context.destination);
        connectIfReady();
      })
      .catch((error: unknown) => finish(captureError(error)));
  });
}
