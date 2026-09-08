import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_CONTEXT_CLOSE_TIMEOUT_MS,
  LIVE_CAPTURE_STOP_TIMEOUT_MS,
  closeDetachedAudioContext,
  waitForLiveCaptureStop,
} from './live-stream-cleanup';

afterEach(() => vi.useRealTimers());

describe('detached live cleanup deadlines', () => {
  it.each(['rejected', 'thrown'] as const)(
    'ignores a %s browser close, not a final-frame error',
    async (mode) => {
      vi.useFakeTimers();
      const close = vi.fn(() => {
        if (mode === 'thrown') throw new Error('browser cleanup failed');
        return Promise.reject(new Error('browser cleanup failed'));
      });
      await closeDetachedAudioContext({ state: 'running', close } as unknown as AudioContext);
      expect(close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      await expect(
        waitForLiveCaptureStop(() => Promise.reject(new Error('final frame failed'))),
      ).rejects.toThrow('final frame failed');
    },
  );

  it('bounds context release and ignores its late completion', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const settled = vi.fn();
    const closing = closeDetachedAudioContext({
      state: 'running',
      close,
    } as unknown as AudioContext).then(settled);
    await vi.advanceTimersByTimeAsync(AUDIO_CONTEXT_CLOSE_TIMEOUT_MS);
    await closing;
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)(
    'a stop timeout stays rejected after a late %s',
    async (mode) => {
      vi.useFakeTimers();
      let resolveStop!: () => void;
      let rejectStop!: (error: Error) => void;
      const stop = () =>
        new Promise<void>((resolve, reject) => {
          resolveStop = resolve;
          rejectStop = reject;
        });
      const result = waitForLiveCaptureStop(stop);
      const rejection = expect(result).rejects.toThrow('unconfirmed');
      await vi.advanceTimersByTimeAsync(LIVE_CAPTURE_STOP_TIMEOUT_MS);
      await rejection;
      if (mode === 'resolve') resolveStop();
      else rejectStop(new Error('late stop failure'));
      await vi.advanceTimersByTimeAsync(0);
      await expect(result).rejects.toThrow('unconfirmed');
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
