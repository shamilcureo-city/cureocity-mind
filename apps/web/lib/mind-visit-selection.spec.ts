import { afterEach, describe, expect, it, vi } from 'vitest';
import { MindVisitSelection } from './mind-visit-selection';

const row = (id = 'visit-a', clientId = 'client-a') => ({
  id,
  clientId,
  kind: 'INTAKE',
  language: 'ml',
  modality: null,
  status: 'SCHEDULED',
  scheduledAt: '2026-09-13T09:00:00.000Z',
  updatedAt: '2026-09-13T08:00:00.000Z',
  mindDocumentationMode: null,
});
const signal = () => new AbortController().signal;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.useRealTimers());

describe('Mind exact visit preparation/start identity', () => {
  it('reads exact saved settings without creating a visit or changing its purpose', async () => {
    const transport = vi.fn().mockResolvedValue(response(row('visit-b')));
    const selected = new MindVisitSelection('client-a', 'visit-b', transport);
    expect(await selected.read(signal())).toMatchObject({ id: 'visit-b', language: 'ml' });
    expect(transport).toHaveBeenCalledWith(
      '/api/v1/sessions/visit-b',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(transport.mock.calls[0][1]).not.toHaveProperty('method');
  });
  it('does not invent a language when an older exact-visit response omits it', async () => {
    const older: Record<string, unknown> = row();
    delete older.language;
    const selected = new MindVisitSelection(
      'client-a',
      'visit-a',
      vi.fn().mockResolvedValue(response(older)),
    );
    expect((await selected.read(signal())).language).toBeUndefined();
  });
  it.each(['client', 'visit', 'missing'])(
    'refuses an unconfirmed %s settings read without a replacement POST',
    async (mismatch) => {
      const transport = vi
        .fn()
        .mockResolvedValue(
          response(
            mismatch === 'missing'
              ? {}
              : row(
                  mismatch === 'visit' ? 'another' : 'visit-a',
                  mismatch === 'client' ? 'another' : 'client-a',
                ),
          ),
        );
      const selected = new MindVisitSelection('client-a', 'visit-a', transport);
      await expect(selected.read(signal())).rejects.toThrow('could not be confirmed');
      expect(transport.mock.calls.every(([url]) => url !== '/api/v1/sessions')).toBe(true);
    },
  );
  it('uses the first request time, not the day an abandoned preflight was opened', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T18:29:00.000Z'));
    const transport = vi.fn().mockResolvedValue(response(row()));
    const selected = new MindVisitSelection('client-a', null, transport);
    vi.setSystemTime(new Date('2026-09-13T18:31:00.000Z'));
    await selected.resolve({}, signal());
    expect(JSON.parse(transport.mock.calls[0][1].body).scheduledAt).toBe(
      '2026-09-13T18:31:00.000Z',
    );
  });
  it.each([408, 429])(
    'retains create uncertainty after an ambiguous HTTP %s response',
    async (status) => {
      const transport = vi.fn().mockResolvedValue(response({}, status));
      const selected = new MindVisitSelection('client-a', null, transport);
      await expect(selected.resolve({}, signal())).rejects.toThrow();
      await expect(selected.resolve({}, signal())).rejects.toThrow('Open Today');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('does not send or mark uncertainty for an already cancelled selection', async () => {
    const transport = vi.fn();
    const selected = new MindVisitSelection('client-a', null, transport);
    const controller = new AbortController();
    controller.abort();
    await expect(selected.resolve({}, controller.signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(selected.needsVisitLookup).toBe(false);
  });
  it('pins the acknowledged walk-in on every retry without creating another visit', async () => {
    const transport = vi.fn().mockResolvedValue(response(row()));
    const selected = new MindVisitSelection('client-a', null, transport);
    await selected.resolve({ language: 'en' }, signal());
    transport.mockResolvedValue(response(row()));
    await selected.resolve({ language: 'en' }, signal());
    expect(selected.sessionId).toBe('visit-a');
    const first = JSON.parse(transport.mock.calls[0][1].body);
    const retry = JSON.parse(transport.mock.calls[1][1].body);
    expect(first).not.toHaveProperty('expectedSessionId');
    expect(retry).toMatchObject({
      clientId: 'client-a',
      expectedSessionId: 'visit-a',
      startNow: true,
    });
    expect(retry.scheduledAt).toBe(first.scheduledAt);
    expect(transport.mock.calls.every(([url]) => url === '/api/v1/sessions')).toBe(true);
  });
  it('uses the explicit second visit for the same day, never a client/date lookup', async () => {
    const transport = vi.fn().mockResolvedValue(response(row('visit-b')));
    const selected = new MindVisitSelection('client-a', 'visit-b', transport);
    await selected.resolve({}, signal());
    expect(JSON.parse(transport.mock.calls[0][1].body).expectedSessionId).toBe('visit-b');
  });
  it.each(['network', 'server', 'invalid', 'wrong-client'])(
    'blocks blind new-visit retry after %s uncertainty',
    async (failure) => {
      const transport = vi.fn();
      if (failure === 'network') transport.mockRejectedValue(new Error('disconnected'));
      else
        transport.mockResolvedValue(
          failure === 'server'
            ? response({}, 500)
            : failure === 'invalid'
              ? response({ id: 'visit-a' })
              : response(row('visit-a', 'client-b')),
        );
      const selected = new MindVisitSelection('client-a', null, transport);
      await expect(selected.resolve({}, signal())).rejects.toThrow();
      expect(selected.needsVisitLookup).toBe(true);
      await expect(selected.resolve({}, signal())).rejects.toThrow('Open Today');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('allows a corrected request after a definitive validation rejection', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(response({ error: 'Invalid language' }, 400))
      .mockResolvedValueOnce(response(row()));
    const selected = new MindVisitSelection('client-a', null, transport);
    await expect(selected.resolve({}, signal())).rejects.toThrow('Invalid language');
    await selected.resolve({ language: 'en' }, signal());
    expect(selected.sessionId).toBe('visit-a');
  });
  it('retains exact booking identity across a lost response so safe retry stays pinned', async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('disconnected'))
      .mockResolvedValueOnce(response(row('visit-b')));
    const selected = new MindVisitSelection('client-a', 'visit-b', transport);
    await expect(selected.resolve({}, signal())).rejects.toThrow();
    expect(selected.needsVisitLookup).toBe(false);
    await selected.resolve({}, signal());
    expect(JSON.parse(transport.mock.calls[1][1].body).expectedSessionId).toBe('visit-b');
  });
  it('cannot replace an explicitly selected visit with a response for another', async () => {
    const transport = vi.fn().mockResolvedValue(response(row('visit-a')));
    const selected = new MindVisitSelection('client-a', 'visit-b', transport);
    await expect(selected.resolve({}, signal())).rejects.toThrow('exact visit');
    expect(selected.sessionId).toBe('visit-b');
  });
  it('retains a validated identity even if cancellation arrives with the acknowledgement', async () => {
    const controller = new AbortController();
    const transport = vi.fn(async () => {
      controller.abort();
      return response(row());
    });
    const selected = new MindVisitSelection('client-a', null, transport);
    await expect(selected.resolve({}, controller.signal)).rejects.toThrow();
    expect(selected.sessionId).toBe('visit-a');
    expect(selected.needsVisitLookup).toBe(false);
  });
  it('rejects simultaneous selection before a second request can be sent', async () => {
    let finish!: (result: Response) => void;
    const transport = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const selected = new MindVisitSelection('client-a', null, transport);
    const first = selected.resolve({}, signal());
    await expect(selected.resolve({}, signal())).rejects.toThrow('in progress');
    finish(response(row()));
    await first;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not carry a prior client or visit into a separate entry flow', async () => {
    const transport = vi.fn().mockResolvedValue(response(row('visit-c', 'client-b')));
    const selected = new MindVisitSelection('client-b', null, transport);
    await selected.resolve({}, signal());
    expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({ clientId: 'client-b' });
    expect(JSON.parse(transport.mock.calls[0][1].body)).not.toHaveProperty('expectedSessionId');
  });
});
