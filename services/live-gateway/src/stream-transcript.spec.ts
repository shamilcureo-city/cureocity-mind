import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import {
  LiveStreamTranscriber,
  buildStreamSetup,
  streamTranscriptConfig,
} from './stream-transcript';

/**
 * Sprint DS13 — the streaming display rail, tested against an in-process
 * fake Gemini Live server (real `ws` sockets, no network).
 */

interface FakeServer {
  url: string;
  sockets: ServerSocket[];
  messages: string[][];
  close: () => Promise<void>;
}

function startFakeGemini(
  onSocket?: (ws: ServerSocket, index: number) => void,
): Promise<FakeServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const address = wss.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        sockets,
        messages,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.terminate();
            wss.close(() => r());
          }),
      });
    });
    const sockets: ServerSocket[] = [];
    const messages: string[][] = [];
    wss.on('connection', (ws) => {
      const index = sockets.length;
      sockets.push(ws);
      messages.push([]);
      ws.on('message', (data) => messages[index]!.push(String(data)));
      onSocket?.(ws, index);
    });
  });
}

const flush = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

let servers: FakeServer[] = [];
let transcribers: LiveStreamTranscriber[] = [];

function make(
  server: FakeServer,
  extra: Partial<ConstructorParameters<typeof LiveStreamTranscriber>[0]> = {},
): { t: LiveStreamTranscriber; partials: string[]; downs: string[] } {
  const partials: string[] = [];
  const downs: string[] = [];
  const t = new LiveStreamTranscriber({
    sessionId: 'sess-test',
    wsUrl: async () => server.url,
    setup: { setup: { model: 'projects/p/locations/l/publishers/google/models/m' } },
    onPartial: (f) => partials.push(f),
    onDown: (r) => downs.push(r),
    baseDelayMs: 10,
    ...extra,
  });
  transcribers.push(t);
  return { t, partials, downs };
}

afterEach(async () => {
  for (const t of transcribers) t.stop();
  transcribers = [];
  for (const s of servers) await s.close();
  servers = [];
  vi.restoreAllMocks();
});

describe('LiveStreamTranscriber', () => {
  it('sends the setup FIRST, queues audio until setupComplete, then flushes it', async () => {
    const server = await startFakeGemini();
    servers.push(server);
    const { t } = make(server);
    t.start();
    t.feed(Buffer.from([1, 2, 3, 4])); // fed before the socket is even open
    await flush();

    expect(server.messages[0]![0]).toContain('"setup"');
    // No audio yet — setupComplete hasn't been sent.
    expect(server.messages[0]!.filter((m) => m.includes('realtime_input'))).toHaveLength(0);

    server.sockets[0]!.send(JSON.stringify({ setupComplete: {} }));
    await flush();
    const audio = server.messages[0]!.filter((m) => m.includes('realtime_input'));
    expect(audio).toHaveLength(1);
    expect(audio[0]).toContain('audio/pcm;rate=16000');
  });

  it('surfaces input_transcription fragments (snake and camel case)', async () => {
    const server = await startFakeGemini((ws) => {
      ws.send(JSON.stringify({ setupComplete: {} }));
    });
    servers.push(server);
    const { t, partials } = make(server);
    t.start();
    await flush();

    server.sockets[0]!.send(
      JSON.stringify({ serverContent: { input_transcription: { text: 'seene mein ' } } }),
    );
    server.sockets[0]!.send(
      JSON.stringify({ serverContent: { inputTranscription: { text: 'dard' } } }),
    );
    // Model output is ignored — display rail listens to the input only.
    server.sockets[0]!.send(
      JSON.stringify({ serverContent: { modelTurn: { parts: [{ text: 'ignored' }] } } }),
    );
    await flush();
    expect(partials).toEqual(['seene mein ', 'dard']);
  });

  it('reconnects after a drop and presents the resumption handle', async () => {
    const server = await startFakeGemini((ws) => {
      ws.send(JSON.stringify({ setupComplete: {} }));
    });
    servers.push(server);
    const { t, downs } = make(server);
    t.start();
    await flush();

    server.sockets[0]!.send(
      JSON.stringify({ sessionResumptionUpdate: { newHandle: 'resume-42', resumable: true } }),
    );
    await flush();
    server.sockets[0]!.close(1011, 'blip');
    await flush(120);

    expect(server.sockets.length).toBe(2);
    const resumeSetup = JSON.parse(server.messages[1]![0]!) as {
      setup?: { session_resumption?: { handle?: string } };
    };
    expect(resumeSetup.setup?.session_resumption?.handle).toBe('resume-42');
    expect(downs).toEqual([]);
  });

  it('goes DOWN (not crash-loop) after maxAttempts consecutive refusals', async () => {
    const server = await startFakeGemini((ws) => {
      ws.close(1008, 'nope'); // refuse before setupComplete, every time
    });
    servers.push(server);
    const { t, downs } = make(server, { maxAttempts: 2, baseDelayMs: 5 });
    t.start();
    await flush(300);

    expect(downs).toHaveLength(1);
    const connectsAtDown = server.sockets.length;
    // Inert afterwards — feeding does not resurrect it.
    t.feed(Buffer.from([1, 2]));
    await flush(100);
    expect(server.sockets.length).toBe(connectsAtDown);
  });

  it('stop() closes without reconnecting', async () => {
    const server = await startFakeGemini((ws) => {
      ws.send(JSON.stringify({ setupComplete: {} }));
    });
    servers.push(server);
    const { t, downs } = make(server);
    t.start();
    await flush();
    t.stop();
    await flush(120);
    expect(server.sockets.length).toBe(1);
    expect(downs).toEqual([]);
  });
});

describe('streamTranscriptConfig', () => {
  it('is OFF unless LIVE_STREAM_TRANSCRIPT === "true"', () => {
    expect(streamTranscriptConfig({})).toBeNull();
    expect(streamTranscriptConfig({ LIVE_STREAM_TRANSCRIPT: '1' })).toBeNull();
    expect(streamTranscriptConfig({ LIVE_STREAM_TRANSCRIPT: 'true' })).toEqual({
      location: 'us-central1',
      model: 'gemini-live-2.5-flash',
    });
    expect(
      streamTranscriptConfig({
        LIVE_STREAM_TRANSCRIPT: 'true',
        LIVE_STREAM_LOCATION: 'asia-south1',
        LIVE_STREAM_MODEL: 'custom-model',
      }),
    ).toEqual({ location: 'asia-south1', model: 'custom-model' });
  });
});

describe('buildStreamSetup', () => {
  it('requests transcription-only with the cost + resilience guards on', () => {
    const setup = buildStreamSetup('proj', { location: 'us-central1', model: 'm' }) as {
      setup: Record<string, unknown>;
    };
    expect(setup.setup['model']).toBe(
      'projects/proj/locations/us-central1/publishers/google/models/m',
    );
    expect(setup.setup['input_audio_transcription']).toEqual({});
    // The two §4.7 guards that keep long consults alive AND cheaply billed.
    expect(setup.setup['session_resumption']).toEqual({});
    expect(setup.setup['context_window_compression']).toEqual({ sliding_window: {} });
    const gen = setup.setup['generation_config'] as { response_modalities: string[] };
    expect(gen.response_modalities).toEqual(['TEXT']);
  });
});
