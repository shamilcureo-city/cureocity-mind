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
  const exp = Math.floor(Date.now() / 1000) + 600;
  const body = Buffer.from(
    JSON.stringify({
      sessionId: 'fictional-session',
      psychologistId: 'fictional-owner',
      vertical: 'THERAPIST',
      capabilities,
      exp,
    }),
  ).toString('base64url');
  const token = `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`;
  socket.command({ type: 'start', sessionId: 'fictional-session', token, vertical: 'THERAPIST' });
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
