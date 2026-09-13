import { EventEmitter } from 'node:events';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalSessionUsagePayload,
  type LiveGatewayEvent,
  type SessionUsageCommand,
} from '@cureocity/contracts';
import { MockGeminiPass1Backend } from '@cureocity/llm';

const fixture = vi.hoisted(() => ({ server: null as unknown as EventEmitter }));
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
  const llm = await import('@cureocity/llm');
  return {
    buildBackends: () => ({
      backend: 'mock',
      pass1: new llm.MockGeminiPass1Backend(),
      pass2: new llm.MockGeminiPass2Backend(),
      reasoning: new llm.MockGeminiReasoningBackend(),
      therapyReasoning: new llm.MockGeminiTherapyReasoningBackend(),
    }),
  };
});
class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  events: LiveGatewayEvent[] = [];
  send(raw: string) {
    this.events.push(JSON.parse(raw) as LiveGatewayEvent);
  }
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit('close');
  }
  command(command: object) {
    this.emit('message', Buffer.from(JSON.stringify(command)), false);
  }
}
const secret = 'fictional-usage-secret';
const capabilities = ['LIVE_ENCOUNTER', 'BEHAVIORAL_HEALTH_DOCUMENTATION', 'MEDICAL_DOCUMENTATION'];
const packets: SessionUsageCommand[] = [];
const sockets: Socket[] = [];
const verifier = vi.fn<typeof fetch>();
const signals = new Map(
  (['SIGTERM', 'SIGINT'] as const).map((signal) => [signal, process.listeners(signal)]),
);
let registrationReply: ((packet: SessionUsageCommand) => Promise<Response>) | null = null;
function receiptReply(packet: SessionUsageCommand) {
  return new Response(
    JSON.stringify({
      version: 1,
      domain: 'CUREOCITY_LIVE_USAGE_V1',
      connectionId: packet.connectionId,
      sessionId: packet.sessionId,
      acceptedSequence: packet.type === 'REGISTER' ? 0 : packet.sequence,
      latestSequence: packet.type === 'REGISTER' ? 0 : packet.sequence,
      status: packet.type === 'REGISTER' ? 'REGISTERED' : 'ACCEPTED',
      payloadHash:
        packet.type === 'REGISTER'
          ? null
          : createHash('sha256').update(canonicalSessionUsagePayload(packet)).digest('hex'),
    }),
  );
}
function token(exp: number, vertical = 'THERAPIST') {
  const body = Buffer.from(
    JSON.stringify({
      sessionId: 'fictional-visit',
      psychologistId: 'fictional-owner',
      vertical,
      capabilities,
      exp,
    }),
  ).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`;
}
function connect(vertical = 'THERAPIST') {
  const socket = new Socket();
  sockets.push(socket);
  fixture.server.emit('connection', socket, {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  });
  const expiresAt = Math.floor(Date.now() / 1_000) + 300;
  socket.command({
    type: 'start',
    sessionId: 'fictional-visit',
    token: token(expiresAt, vertical),
    vertical,
  });
  return { socket, expiresAt };
}
beforeAll(async () => {
  vi.stubEnv('LIVE_GATEWAY_SECRET', secret);
  vi.stubEnv(
    'LIVE_AUTHZ_REVALIDATE_URL',
    'https://fictional.example/api/v1/internal/live-authority',
  );
  vi.stubEnv('LIVE_USAGE_RECEIPTS_ENABLED', 'true');
  vi.stubGlobal('fetch', verifier);
  await import('./server');
});
beforeEach(() => {
  registrationReply = null;
  packets.length = 0;
  verifier.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/live-authority'))
      return new Response(JSON.stringify({ authorized: true, capabilities }));
    expect(String(url)).toBe('https://fictional.example/api/v1/internal/session-usage');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${secret}` });
    const packet = JSON.parse(String(init?.body)) as SessionUsageCommand;
    packets.push(packet);
    return packet.type === 'REGISTER' && registrationReply
      ? registrationReply(packet)
      : receiptReply(packet);
  });
});
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.close());
  await new Promise((resolve) => setTimeout(resolve, 5));
  vi.restoreAllMocks();
});
afterAll(() => {
  for (const [signal, previous] of signals)
    for (const listener of process.listeners(signal))
      if (!previous.includes(listener)) process.removeListener(signal, listener);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('actual gateway durable registration and socket lifecycle', () => {
  it('waits for durable registration before listening or constructing billable work', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    registrationReply = async (packet) => {
      await held;
      return receiptReply(packet);
    };
    const provider = vi.spyOn(MockGeminiPass1Backend.prototype, 'run');
    const { socket } = connect();
    await vi.waitFor(() => expect(packets).toHaveLength(1));
    expect(socket.events).not.toContainEqual({ type: 'status', state: 'listening' });
    expect(provider).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'status', state: 'listening' }),
    );
    expect(packets[0]).toMatchObject({
      type: 'REGISTER',
      sessionId: 'fictional-visit',
      psychologistId: 'fictional-owner',
    });
  });

  it('sends a non-retry service error on failed registration and never falls through to recording', async () => {
    registrationReply = async () => new Response('{}', { status: 503 });
    const provider = vi.spyOn(MockGeminiPass1Backend.prototype, 'run');
    const { socket } = connect();
    await vi.waitFor(() => expect(socket.events).toContainEqual({ type: 'usageUnavailable' }), {
      timeout: 2_000,
    });
    expect(socket.readyState).toBe(3);
    expect(socket.events).not.toContainEqual({ type: 'status', state: 'listening' });
    expect(provider).not.toHaveBeenCalled();
    expect(packets).toHaveLength(3);
  });

  it('does not revive a socket closed while registration is awaiting acknowledgement', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    registrationReply = async (packet) => {
      await held;
      return receiptReply(packet);
    };
    const { socket } = connect();
    await vi.waitFor(() => expect(packets).toHaveLength(1));
    socket.close();
    release();
    await vi.waitFor(() =>
      expect(packets.some((p) => p.type === 'RECEIPT' && p.state === 'INCOMPLETE')).toBe(true),
    );
    expect(socket.events).not.toContainEqual({ type: 'status', state: 'listening' });
  });

  it('keeps registration on renewal but gives a reused start token a fresh actual-socket identity', async () => {
    const { socket, expiresAt } = connect();
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'status', state: 'listening' }),
    );
    socket.command({
      type: 'renewToken',
      token: token(expiresAt + 300),
      requestId: '10000000-0000-4000-8000-000000000001',
    });
    await vi.waitFor(() => expect(socket.events.some((e) => e.type === 'tokenRenewed')).toBe(true));
    expect(packets.filter((p) => p.type === 'REGISTER')).toHaveLength(1);
    socket.close();
    const second = connect().socket;
    await vi.waitFor(() =>
      expect(second.events).toContainEqual({ type: 'status', state: 'listening' }),
    );
    const registrations = packets.filter((p) => p.type === 'REGISTER');
    expect(registrations).toHaveLength(2);
    expect(registrations[0].connectionId).not.toBe(registrations[1].connectionId);
  });

  it('records a late provider settlement after browser loss independently of clinical output delivery', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = MockGeminiPass1Backend.prototype.run;
    const provider = vi
      .spyOn(MockGeminiPass1Backend.prototype, 'run')
      .mockImplementation(async function (this: MockGeminiPass1Backend, input) {
        await held;
        return original.call(this, input);
      });
    const { socket } = connect();
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'status', state: 'listening' }),
    );
    const speech = Buffer.alloc(4_000 * 32);
    for (let i = 0; i < speech.length; i += 2) speech.writeInt16LE(8000, i);
    socket.emit('message', speech, true);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    socket.close();
    release();
    await vi.waitFor(() =>
      expect(
        packets.some(
          (p) => p.type === 'RECEIPT' && p.state === 'INCOMPLETE' && p.totals.pass1Calls === 1,
        ),
      ).toBe(true),
    );
    expect(socket.events.some((e) => e.type === 'utterance')).toBe(false);
  });

  it('leaves Scribe outside the first rollout even with the Mind flag enabled', async () => {
    const { socket } = connect('DOCTOR');
    await vi.waitFor(() =>
      expect(socket.events).toContainEqual({ type: 'status', state: 'listening' }),
    );
    expect(packets).toEqual([]);
  });

  it('does not allow the development no-secret path to bypass enabled usage registration', async () => {
    vi.stubEnv('LIVE_GATEWAY_SECRET', '');
    try {
      const { socket } = connect();
      await vi.waitFor(() => expect(socket.events).toContainEqual({ type: 'usageUnavailable' }));
      expect(socket.events).not.toContainEqual({ type: 'status', state: 'listening' });
      expect(packets).toEqual([]);
    } finally {
      vi.stubEnv('LIVE_GATEWAY_SECRET', secret);
    }
  });
});
