import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRecordingCursor } from './recording-cursor';
afterEach(() => vi.unstubAllGlobals());
describe('recording cursor request', () => {
  it('reads a noncached server position with a bounded authenticated request', async () => {
    const request = vi.fn(async () => Response.json({ nextChunkIndex: 12 }));
    vi.stubGlobal('fetch', request);
    expect(await getRecordingCursor('session/1', '/api/v1', async () => 'fictional-token')).toBe(
      12,
    );
    expect(request).toHaveBeenCalledWith(
      '/api/v1/sessions/session%2F1/audio-cursor',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });
  it.each([{}, { nextChunkIndex: -1 }, { nextChunkIndex: 1.5 }, { nextChunkIndex: '2' }])(
    'refuses malformed position %j',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(payload)),
      );
      await expect(getRecordingCursor('s-1')).rejects.toThrow('could not be verified');
    },
  );
  it('does not turn authorization failure into a fresh zero cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    await expect(getRecordingCursor('s-1')).rejects.toThrow('Keep capture off');
  });
});
