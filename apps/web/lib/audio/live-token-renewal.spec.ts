import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveGatewayCommand } from '@cureocity/contracts';
import { LiveTokenRenewal } from './live-token-renewal';

const startTime = Date.parse('2026-09-08T00:00:00Z');
const requestId = 'd1d9c73e-ef13-4d38-956c-c5d49572b9be';

function response(
  body: unknown = { token: 'fresh-signed-token', expiresInSec: 300 },
  status = 200,
) {
  return new Response(JSON.stringify(body), { status });
}

function setup(overrides: Partial<{ requestedAtMs: number; expiresInSec: number }> = {}) {
  const send = vi.fn<(command: LiveGatewayCommand) => void>();
  const onFailure = vi.fn();
  const renewal = new LiveTokenRenewal({
    sessionId: 'fictional-session',
    initialLease: { requestedAtMs: startTime, expiresInSec: 300, ...overrides },
    send,
    onFailure,
  });
  return { renewal, send, onFailure };
}

describe('live token renewal on an existing socket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(startTime);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => response()),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renews for more than one hour using only correlated renew commands', async () => {
    const { renewal, send, onFailure } = setup();
    renewal.start();
    renewal.start();
    for (let i = 0; i < 16; i++) {
      await vi.advanceTimersByTimeAsync(240_000);
      expect(send).toHaveBeenCalledTimes(i + 1);
      const command = send.mock.calls[i]![0];
      expect(command.type).toBe('renewToken');
      if (command.type !== 'renewToken') throw new Error('Expected renewal');
      renewal.handleEvent({
        type: 'tokenRenewed',
        requestId: command.requestId,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      });
    }
    expect(Date.now() - startTime).toBe(3_840_000);
    expect(onFailure).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(16);
    expect(fetch).toHaveBeenCalledWith('/api/v1/sessions/fictional-session/live-token', {
      method: 'POST',
      signal: expect.any(AbortSignal),
    });
    renewal.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accounts for initial mint latency rather than starting a new TTL on listening', async () => {
    vi.setSystemTime(startTime + 30_000);
    const { renewal, send } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(216_000);
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([-600_000, 600_000])(
    'renews when the local clock is %s ms from the server',
    async (skew) => {
      vi.setSystemTime(startTime + skew);
      const { renewal, send, onFailure } = setup({ requestedAtMs: startTime + skew });
      renewal.start();
      await vi.advanceTimersByTimeAsync(240_000);
      const command = send.mock.calls[0]![0];
      if (command.type !== 'renewToken') throw new Error('Expected renewal');
      renewal.handleEvent({
        type: 'tokenRenewed',
        requestId: command.requestId,
        expiresAt: startTime / 1000 + 540,
      });
      await vi.advanceTimersByTimeAsync(240_000);
      expect(send).toHaveBeenCalledTimes(2);
      expect(onFailure).not.toHaveBeenCalled();
    },
  );

  it('times out missing or mismatched acknowledgement and fails only once', async () => {
    const { renewal, onFailure } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    renewal.handleEvent({ type: 'tokenRenewed', requestId, expiresAt: startTime / 1000 + 900 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onFailure).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500_000);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 409, 500])('fails closed on rejected mint (%s)', async (status) => {
    vi.mocked(fetch).mockResolvedValue(response({}, status));
    const { renewal, send, onFailure } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(send).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {},
    { token: '', expiresInSec: 300 },
    { token: 'x'.repeat(8193), expiresInSec: 300 },
    { token: 'token', expiresInSec: 0 },
    { token: 'token', expiresInSec: '300' },
    { token: 'token', expiresInSec: 1 },
    { token: 'token', expiresInSec: 100_000 },
  ])('rejects an invalid or non-extending mint response %#', async (body) => {
    vi.mocked(fetch).mockResolvedValue(response(body));
    const { renewal, onFailure, send } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(send).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('aborts a stuck mint and ignores late success', async () => {
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => (complete = resolve)));
    const { renewal, send, onFailure } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(260_000);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal!.aborted).toBe(true);
    complete(response());
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('disposal during mint prevents late response from renewing a stopped or replaced socket', async () => {
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => (complete = resolve)));
    const { renewal, send, onFailure } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    renewal.dispose();
    complete(response());
    await vi.advanceTimersByTimeAsync(0);
    renewal.start();
    expect(send).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposal while waiting for acknowledgement cannot revive or fail a stopped socket', async () => {
    const { renewal, send, onFailure } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    const command = send.mock.calls[0]![0];
    if (command.type !== 'renewToken') throw new Error('Expected renewal');
    renewal.dispose();
    renewal.handleEvent({
      type: 'tokenRenewed',
      requestId: command.requestId,
      expiresAt: startTime / 1000 + 540,
    });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(onFailure).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not extend the current deadline while waiting for an acknowledgement', async () => {
    const { renewal, send, onFailure } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    const command = send.mock.calls[0]![0];
    if (command.type !== 'renewToken') throw new Error('Expected renewal');
    // Simulate a backgrounded tab resuming after expiry, before timer callbacks.
    vi.setSystemTime(startTime + 301_000);
    renewal.handleEvent({
      type: 'tokenRenewed',
      requestId: command.requestId,
      expiresAt: startTime / 1000 + 540,
    });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the acknowledged deadline to the freshly minted lease', async () => {
    const { renewal, send, onFailure } = setup();
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    const command = send.mock.calls[0]![0];
    if (command.type !== 'renewToken') throw new Error('Expected renewal');
    renewal.handleEvent({
      type: 'tokenRenewed',
      requestId: command.requestId,
      expiresAt: startTime / 1000 + 86_400,
    });
    await vi.advanceTimersByTimeAsync(240_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('fails closed if sending a renewal to the socket throws', async () => {
    const { renewal, send, onFailure } = setup();
    send.mockImplementation(() => {
      throw new Error('Socket closed');
    });
    renewal.start();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an already expired initial lease without making requests', () => {
    const { renewal, onFailure } = setup({ requestedAtMs: startTime - 300_000 });
    renewal.start();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
