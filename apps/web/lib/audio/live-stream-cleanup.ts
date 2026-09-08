export const AUDIO_CONTEXT_CLOSE_TIMEOUT_MS = 1_000;
export const LIVE_CAPTURE_STOP_TIMEOUT_MS = 4_000;

/**
 * Call only after stopping the physical tracks and disconnecting the graph.
 * Context release is best-effort browser cleanup, not proof of a final frame.
 * A hung/rejected close must not hold the capture lifecycle hostage.
 */
export function closeDetachedAudioContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'closed') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, AUDIO_CONTEXT_CLOSE_TIMEOUT_MS);
    try {
      void ctx.close().then(finish, finish);
    } catch {
      finish();
    }
  });
}

/** Outer UI guard: the real hook normally settles within 2s flush + 1s cleanup. */
export function waitForLiveCaptureStop(stop: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error('Capture cleanup took too long; the final audio frame is unconfirmed.')),
      LIVE_CAPTURE_STOP_TIMEOUT_MS,
    );
    try {
      void stop().then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
