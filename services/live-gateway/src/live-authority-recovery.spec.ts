import type { LiveGatewayEvent, PractitionerCapability } from '@cureocity/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveAuthority } from './live-authority';
import { OrderedSocketOutput } from './ordered-socket-output';

const note: LiveGatewayEvent = { type: 'note', partial: {} };
const pause: LiveGatewayEvent = {
  type: 'capturePaused',
  requestId: '00000000-0000-4000-8000-000000000001',
};
const required = ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'] as PractitionerCapability[];
const grant = (capabilities = required) =>
  new Response(JSON.stringify({ authorized: true, capabilities }));
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function setup(vertical: 'DOCTOR' | 'THERAPIST' = 'DOCTOR') {
  const close = vi.fn();
  const diagnostic = vi.fn();
  const fetchImpl = vi.fn<typeof fetch>();
  let now = 1_999_999_999_000;
  const documentation: PractitionerCapability =
    vertical === 'DOCTOR' ? 'MEDICAL_DOCUMENTATION' : 'BEHAVIORAL_HEALTH_DOCUMENTATION';
  const capabilities: PractitionerCapability[] = ['LIVE_ENCOUNTER', documentation];
  const auth = new LiveAuthority({
    sessionId: 'DO-NOT-LOG-session',
    psychologistId: 'DO-NOT-LOG-owner',
    tokenExpiresAt: 2_000_000_000,
    vertical,
    requiredCapabilities: new Set(capabilities),
    verifierUrl: 'https://DO-NOT-LOG.internal/authority',
    serviceSecret: 'DO-NOT-LOG-secret',
    fetchImpl,
    close,
    diagnostic,
    updateCapabilities: vi.fn(),
    now: () => now,
  });
  return {
    auth,
    fetchImpl,
    close,
    diagnostic,
    capabilities,
    setNow: (value: number) => {
      now = value;
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe('authority failure classification (all outcomes remain fail-closed)', () => {
  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'distinguishes dependency outages from denial for %s',
    async (vertical) => {
      for (const status of [401, 403, 408, 429, 500, 502, 503]) {
        const { auth, fetchImpl, close, diagnostic } = setup(vertical);
        fetchImpl.mockResolvedValue(new Response('{}', { status }));
        await expect(auth.authorizeCurrentInput()).resolves.toBe(false);
        const reason =
          status === 401 || status === 403 ? 'live_authority_denied' : 'live_authority_unavailable';
        expect(close).toHaveBeenCalledExactlyOnceWith(reason);
        expect(diagnostic).toHaveBeenCalledWith(
          expect.objectContaining({ reason, httpStatus: status, purpose: 'capture' }),
        );
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('DO-NOT-LOG');
        await expect(auth.authorizeEvent(note)).resolves.toBeNull();
        expect(fetchImpl).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([
    ['explicit denial', { authorized: false }, 'live_authority_denied'],
    [
      'missing mandatory capability',
      { authorized: true, capabilities: ['LIVE_ENCOUNTER'] },
      'live_authority_denied',
    ],
    ['missing fields', {}, 'live_authority_unavailable'],
    ['null body', null, 'live_authority_unavailable'],
    [
      'invalid capabilities',
      { authorized: true, capabilities: ['UNKNOWN'] },
      'live_authority_unavailable',
    ],
  ])('classifies %s without exposing response content', async (_label, body, reason) => {
    const { auth, fetchImpl, close } = setup();
    fetchImpl.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(auth.authorizeCurrentInput()).resolves.toBe(false);
    expect(close).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it('classifies network errors without logging raw exceptions', async () => {
    const { auth, fetchImpl, diagnostic, close } = setup();
    fetchImpl.mockRejectedValue(new Error('DO-NOT-LOG-token-and-patient'));
    await expect(auth.authorizeCurrentInput()).resolves.toBe(false);
    expect(close).toHaveBeenCalledWith('live_authority_unavailable');
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith({
      reason: 'live_authority_unavailable',
      category: 'network',
      purpose: 'capture',
      elapsedMs: 0,
    });
  });

  it('keeps a bounded four-second verifier budget and rejects even a late successful reply', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const controller = new AbortController();
    timeout.mockReturnValue(controller.signal);
    const { auth, fetchImpl, close, diagnostic } = setup();
    const pending = deferred();
    fetchImpl.mockReturnValue(pending.promise);
    const result = auth.authorizeCurrentInput();
    expect(timeout).toHaveBeenCalledWith(4_000);
    controller.abort();
    pending.resolve(grant());
    await expect(result).resolves.toBe(false);
    expect(close).toHaveBeenCalledWith('live_authority_unavailable');
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ category: 'timeout' }));
  });
});

describe('fresh, bounded output batches', () => {
  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'uses one check for already queued events in %s and preserves Pause order',
    async (vertical) => {
      const { auth, fetchImpl, capabilities } = setup(vertical);
      fetchImpl.mockImplementation(async () => grant(capabilities));
      const sent: LiveGatewayEvent[] = [];
      const queue = new OrderedSocketOutput<LiveGatewayEvent>(
        (batch) =>
          auth.authorizeEventBatch(batch, (event) => {
            sent.push(event);
          }),
        () => {
          throw new Error('unexpected queue failure');
        },
      );
      queue.enqueue(note);
      queue.enqueue(pause);
      await vi.waitFor(() => expect(sent).toEqual([note, pause]));
      expect(fetchImpl).toHaveBeenCalledOnce();
      queue.enqueue(note);
      await vi.waitFor(() => expect(sent).toHaveLength(3));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      queue.dispose();
      auth.dispose();
    },
  );

  it('does not let events arriving during a request use that earlier grant', async () => {
    const { auth, fetchImpl, close } = setup();
    const pending = deferred();
    fetchImpl
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    const sent: LiveGatewayEvent[] = [];
    const queue = new OrderedSocketOutput<LiveGatewayEvent>(
      (batch) =>
        auth.authorizeEventBatch(batch, (event) => {
          sent.push(event);
        }),
      vi.fn(),
    );
    queue.enqueue(note);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    queue.enqueue(pause);
    pending.resolve(grant());
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith('live_authority_denied'));
    expect(sent).toEqual([note]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('waits for an older queued-authority request then starts its own fresh check', async () => {
    const { auth, fetchImpl } = setup();
    const old = deferred();
    fetchImpl.mockReturnValueOnce(old.promise).mockResolvedValueOnce(grant());
    const earlier = auth.authorizeQueuedControl();
    const send = vi.fn();
    const batch = auth.authorizeEventBatch([note, pause], send);
    expect(fetchImpl).toHaveBeenCalledOnce();
    old.resolve(grant());
    await earlier;
    await batch;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([event]) => event)).toEqual([note, pause]);
  });

  it('never shares a queued-finalization batch grant with capture', async () => {
    const { auth, fetchImpl, close } = setup();
    const output = deferred();
    fetchImpl.mockImplementation(async (_url, options) =>
      JSON.parse(String(options?.body)).purpose === 'capture'
        ? new Response('{}', { status: 403 })
        : output.promise,
    );
    const send = vi.fn();
    const batch = auth.authorizeEventBatch([note, pause], send);
    await expect(auth.authorizeCurrentInput()).resolves.toBe(false);
    output.resolve(grant());
    await batch;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledExactlyOnceWith('live_authority_denied');
  });

  it.each(['expiry', 'disposal'] as const)(
    'rechecks %s at each actual send, not only at batch approval',
    async (stop) => {
      const { auth, fetchImpl, setNow } = setup();
      fetchImpl.mockResolvedValue(grant());
      const sent: LiveGatewayEvent[] = [];
      await auth.authorizeEventBatch([note, pause], (event) => {
        sent.push(event);
        if (stop === 'expiry') setNow(2_000_000_000_000);
        else auth.dispose();
      });
      expect(sent).toEqual([note]);
    },
  );

  it('filters optional output without dropping an authorized documentation event', async () => {
    const { auth, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(grant());
    const reasoning = { type: 'reasoning', reasoning: {} } as LiveGatewayEvent;
    const sent = vi.fn();
    await auth.authorizeEventBatch([reasoning, note, pause], sent);
    expect(sent.mock.calls.map(([event]) => event)).toEqual([note, pause]);
    expect(sent.mock.calls.map(([, index]) => index)).toEqual([1, 2]);
  });

  it.each([false, true])(
    'filters the final medication/order payload at batch send (prescription grant: %s)',
    async (prescription) => {
      const { auth, fetchImpl } = setup();
      fetchImpl.mockResolvedValue(
        grant([...required, ...(prescription ? ['PRESCRIPTION_DRAFTING' as const] : [])]),
      );
      const final = {
        type: 'final',
        medications: [{ drug: 'fictional' }],
        orders: [{ description: 'fictional' }],
        rxPad: { fictional: true },
      } as unknown as LiveGatewayEvent;
      const sent = vi.fn();
      await auth.authorizeEventBatch([final], sent);
      expect(sent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'final',
          medications: prescription ? [{ drug: 'fictional' }] : [],
          orders: [],
          rxPad: prescription ? { fictional: true } : undefined,
        }),
        0,
      );
    },
  );

  it('bounds the queued backlog and disposes unsent work on overflow', async () => {
    const consume = vi.fn(async () => undefined);
    const failure = vi.fn();
    const queue = new OrderedSocketOutput<LiveGatewayEvent>(consume, failure, 1);
    queue.enqueue(note);
    queue.enqueue(pause);
    await Promise.resolve();
    expect(failure).toHaveBeenCalledOnce();
    expect(consume).not.toHaveBeenCalled();
  });
});
