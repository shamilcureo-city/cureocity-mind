import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LiveGatewayEvent } from '@cureocity/contracts';

const fixture = vi.hoisted(() => ({ server: null as unknown as EventEmitter }));
// Run the actual gateway handler and authority/session adapters. Only sockets,
// HTTP verifier and LLM backends are fictional; no port or external call opens.
vi.mock('node:http', () => ({ createServer: () => ({ listen: vi.fn(), close: vi.fn() }) }));
vi.mock('ws', () => ({
  WebSocketServer: class extends EventEmitter {
    clients = new Set();
    constructor() {
      super();
      fixture.server = this;
    }
  },
}));
vi.mock('./sentry', () => ({ initSentry: vi.fn(), reportError: vi.fn() }));
vi.mock('./llm', async () => {
  const {
    MockGeminiPass1Backend,
    MockGeminiPass2Backend,
    MockGeminiReasoningBackend,
    MockGeminiTherapyReasoningBackend,
  } = await import('@cureocity/llm');
  return {
    buildBackends: () => ({
      backend: 'mock',
      pass1: new MockGeminiPass1Backend(),
      pass2: new MockGeminiPass2Backend(),
      reasoning: new MockGeminiReasoningBackend(),
      therapyReasoning: new MockGeminiTherapyReasoningBackend(),
    }),
  };
});

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  events: LiveGatewayEvent[] = [];
  send = (raw: string) => {
    this.events.push(JSON.parse(raw) as LiveGatewayEvent);
  };
  close = () => {
    this.readyState = 3;
    this.emit('close');
  };
  command(command: object) {
    this.emit('message', Buffer.from(JSON.stringify(command)), false);
  }
}
const capabilities = ['LIVE_ENCOUNTER', 'BEHAVIORAL_HEALTH_DOCUMENTATION'];
const secret = 'fictional-local-pause-secret';
const requestId = '00000000-0000-4000-8000-000000000001';
const verifier = vi.fn<typeof fetch>();
const sockets: Socket[] = [];
const signals = new Map(
  (['SIGTERM', 'SIGINT'] as const).map((signal) => [signal, process.listeners(signal)]),
);
const authorized = () => new Response(JSON.stringify({ authorized: true, capabilities }));
function token(exp: number, overrides: object = {}) {
  const body = Buffer.from(
    JSON.stringify({
      sessionId: 'fictional-session',
      psychologistId: 'fictional-owner',
      vertical: 'THERAPIST',
      capabilities,
      exp,
      ...overrides,
    }),
  ).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`;
}
function audioFrame() {
  const audio = Buffer.alloc(9_600);
  for (let i = 0; i < audio.length; i += 2) audio.writeInt16LE(8000, i);
  return audio;
}

beforeAll(async () => {
  vi.stubEnv('LIVE_GATEWAY_SECRET', secret);
  vi.stubEnv(
    'LIVE_AUTHZ_REVALIDATE_URL',
    'http://fictional.internal/api/v1/internal/live-authority',
  );
  vi.stubGlobal('fetch', verifier);
  await import('./server');
});
afterEach(() => {
  sockets.splice(0).forEach((socket) => socket.close());
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  verifier.mockReset();
  vi.restoreAllMocks();
});
afterAll(() => {
  for (const [signal, previous] of signals)
    for (const listener of process.listeners(signal))
      if (!previous.includes(listener)) process.removeListener(signal, listener);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function connect() {
  verifier.mockImplementation(async () => authorized());
  const socket = new Socket();
  sockets.push(socket);
  fixture.server.emit('connection', socket, {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  });
  const exp = Math.floor(Date.now() / 1000) + 300;
  socket.command({
    type: 'start',
    sessionId: 'fictional-session',
    token: token(exp),
    vertical: 'THERAPIST',
  });
  await vi.waitFor(() =>
    expect(socket.events).toContainEqual({ type: 'status', state: 'listening' }),
  );
  return { socket, exp };
}

describe('actual gateway pause command/authorization wiring', () => {
  it('ordered final audio is transcribed before pause acknowledgement despite slow authorization', async () => {
    const { socket } = await connect();
    let grant!: (response: Response) => void;
    verifier.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const audio = Buffer.alloc(9_600);
    for (let i = 0; i < audio.length; i += 2) audio.writeInt16LE(8000, i);
    socket.emit('message', audio, true);
    socket.command({ type: 'pause', requestId });
    expect(socket.events.some((e) => e.type === 'capturePaused')).toBe(false);
    grant(authorized());
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'capturePaused', requestId }),
    );
    const ack = socket.events.findIndex((e) => e.type === 'capturePaused');
    const utterance = socket.events.findIndex((e) => e.type === 'utterance');
    expect(utterance).toBeGreaterThan(-1);
    expect(utterance).toBeLessThan(ack);
    expect(socket.events.some((e) => e.type === 'therapyFinal')).toBe(false);
    socket.command({ type: 'stop' });
    await vi.waitFor(() => expect(socket.events).toContainEqual({ type: 'status', state: 'done' }));
  });

  it('revocation during queued audio denies both input and pause acknowledgement', async () => {
    const { socket } = await connect();
    verifier.mockImplementation(async () => new Response('{}', { status: 403 }));
    socket.emit('message', Buffer.alloc(9600), true);
    socket.command({ type: 'pause', requestId });
    await vi.waitFor(() => expect(socket.readyState).toBe(3));
    expect(socket.events).toContainEqual({ type: 'status', state: 'unauthorized' });
    expect(socket.events.some((e) => e.type === 'utterance' || e.type === 'capturePaused')).toBe(
      false,
    );
  });

  it('pause input cannot renew an expired connection token', async () => {
    const now = vi.spyOn(Date, 'now');
    const { socket, exp } = await connect();
    now.mockReturnValue(exp * 1000 + 1);
    socket.command({ type: 'pause', requestId });
    await vi.waitFor(() => expect(socket.readyState).toBe(3));
    expect(socket.events.some((e) => e.type === 'capturePaused')).toBe(false);
  });
});

describe('actual gateway in-place token renewal wiring', () => {
  it('retains queued audio and elapsed time beyond the original expiry without starting a second session', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    const { socket, exp } = await connect();
    socket.emit('message', audioFrame(), true);
    now.mockReturnValue((exp - 60) * 1000);
    socket.command({ type: 'renewToken', requestId, token: token(exp + 240) });
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({
        type: 'tokenRenewed',
        requestId,
        expiresAt: exp + 240,
      }),
    );
    now.mockReturnValue((exp + 50) * 1000);
    socket.emit('message', audioFrame(), true);
    socket.command({ type: 'pause', requestId });
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'capturePaused', requestId }),
    );
    const utterances = socket.events.flatMap((event) =>
      event.type === 'utterance' ? [event.utterance] : [],
    );
    expect(Math.max(...utterances.map((utterance) => utterance.tEndMs))).toBe(600);
    expect(
      socket.events.filter((event) => event.type === 'status' && event.state === 'listening'),
    ).toHaveLength(1);
    expect(socket.events).toContainEqual(
      expect.objectContaining({
        type: 'meter',
        summary: expect.objectContaining({ elapsedMs: 350_000 }),
      }),
    );
    expect(socket.readyState).toBe(1);
  });

  it('keeps pause acknowledged and microphone-independent capture paused through renewal', async () => {
    const { socket, exp } = await connect();
    socket.emit('message', audioFrame(), true);
    socket.command({ type: 'pause', requestId });
    socket.command({ type: 'renewToken', requestId, token: token(exp + 240) });
    await vi.waitFor(() =>
      expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(true),
    );
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'capturePaused', requestId }),
    );
    const pauseIndex = socket.events.findIndex((event) => event.type === 'capturePaused');
    const wordIndex = socket.events.findIndex((event) => event.type === 'utterance');
    // Renewal is auth-only. Its ACK need not wait behind clinical output, but
    // capturePaused must still come after every acknowledged captured word.
    expect(wordIndex).toBeGreaterThan(-1);
    expect(pauseIndex).toBeGreaterThan(wordIndex);
    const priorWords = socket.events.filter((event) => event.type === 'utterance');
    socket.emit('message', audioFrame(), true);
    socket.command({ type: 'stop' });
    await vi.waitFor(() => expect(socket.events).toContainEqual({ type: 'status', state: 'done' }));
    expect(socket.events.filter((event) => event.type === 'utterance')).toEqual(priorWords);
  });

  it('gates audio and pause behind the in-flight renewal verifier without changing their order', async () => {
    const { socket, exp } = await connect();
    let approve!: (response: Response) => void;
    verifier.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { tokenExpiresAt: number };
      if (body.tokenExpiresAt === exp + 240)
        return new Promise<Response>((resolve) => (approve = resolve));
      return authorized();
    });
    socket.command({ type: 'renewToken', requestId, token: token(exp + 240) });
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    socket.emit('message', audioFrame(), true);
    socket.command({ type: 'pause', requestId });
    expect(socket.events.some((event) => event.type === 'capturePaused')).toBe(false);
    verifier.mockImplementation(async () => authorized());
    approve(authorized());
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'capturePaused', requestId }),
    );
    const renewalIndex = socket.events.findIndex((event) => event.type === 'tokenRenewed');
    const wordIndex = socket.events.findIndex((event) => event.type === 'utterance');
    const pauseIndex = socket.events.findIndex((event) => event.type === 'capturePaused');
    expect(renewalIndex).toBeGreaterThan(-1);
    expect(wordIndex).toBeGreaterThan(renewalIndex);
    expect(pauseIndex).toBeGreaterThan(wordIndex);
  });

  it('does not acknowledge pending renewal after stop intent and still flushes the ordered audio tail', async () => {
    const { socket, exp } = await connect();
    let approve!: (response: Response) => void;
    verifier.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { tokenExpiresAt: number };
      if (body.tokenExpiresAt === exp + 240)
        return new Promise<Response>((resolve) => (approve = resolve));
      return authorized();
    });
    socket.emit('message', audioFrame(), true);
    socket.command({ type: 'renewToken', requestId, token: token(exp + 240) });
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    socket.emit('message', audioFrame(), true);
    socket.command({ type: 'stop' });
    approve(authorized());
    await vi.waitFor(() => expect(socket.events).toContainEqual({ type: 'status', state: 'done' }));
    expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(false);
    expect(
      Math.max(
        ...socket.events.flatMap((event) =>
          event.type === 'utterance' ? [event.utterance.tEndMs] : [],
        ),
      ),
    ).toBe(600);
    socket.command({ type: 'renewToken', requestId, token: token(exp + 480) });
    await vi.waitFor(() => expect(verifier).toHaveBeenCalled());
    expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(false);
  });

  it.each([
    ['identity mismatch', (exp: number) => token(exp + 240, { psychologistId: 'other-owner' })],
    ['same-expiry replay', (exp: number) => token(exp)],
    ['invalid signature', () => 'invalid'],
  ])('closes the actual socket on %s renewal', async (_label, makeToken) => {
    const { socket, exp } = await connect();
    socket.command({ type: 'renewToken', requestId, token: makeToken(exp) });
    await vi.waitFor(() => expect(socket.readyState).toBe(3));
    expect(socket.events).toContainEqual({ type: 'status', state: 'unauthorized' });
    expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(false);
  });

  it('fails closed for malformed renewal instead of leaving its sender waiting for an acknowledgement', async () => {
    const { socket, exp } = await connect();
    socket.command({ type: 'renewToken', requestId: 'not-a-uuid', token: token(exp + 240) });
    expect(socket.readyState).toBe(3);
    expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(false);
  });

  it('rejects revoked current authority even when the renewed token is correctly signed', async () => {
    const { socket, exp } = await connect();
    verifier.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { tokenExpiresAt: number };
      return body.tokenExpiresAt === exp + 240 ? new Response('{}', { status: 403 }) : authorized();
    });
    socket.command({ type: 'renewToken', requestId, token: token(exp + 240) });
    await vi.waitFor(() => expect(socket.readyState).toBe(3));
    expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(false);
  });

  it('cannot send a late acknowledgement after disposal', async () => {
    const { socket, exp } = await connect();
    let approve!: (response: Response) => void;
    verifier.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { tokenExpiresAt: number };
      return body.tokenExpiresAt === exp + 240
        ? new Promise<Response>((resolve) => (approve = resolve))
        : authorized();
    });
    socket.command({ type: 'renewToken', requestId, token: token(exp + 240) });
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    socket.close();
    approve(authorized());
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(false);
  });

  // SIGTERM is terminal for this imported server; keep this fixture last.
  it('drain prevents pending renewal without finalizing an intentionally paused session', async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { socket, exp } = await connect();
    socket.command({ type: 'pause', requestId });
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'capturePaused', requestId }),
    );
    let approve!: (response: Response) => void;
    verifier.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { tokenExpiresAt: number };
      return body.tokenExpiresAt === exp + 240
        ? new Promise<Response>((resolve) => (approve = resolve))
        : authorized();
    });
    socket.command({ type: 'renewToken', requestId, token: token(exp + 240) });
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    const drain = process
      .listeners('SIGTERM')
      .find((listener) => !signals.get('SIGTERM')?.includes(listener));
    expect(drain).toBeDefined();
    drain?.('SIGTERM');
    approve(authorized());
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(socket.events.some((event) => event.type === 'tokenRenewed')).toBe(false);
    expect(
      socket.events.some(
        (event) =>
          event.type === 'therapyFinal' ||
          (event.type === 'status' && event.state === 'finalizing'),
      ),
    ).toBe(false);
  });
});
