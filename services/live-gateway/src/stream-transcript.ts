import WebSocket from 'ws';
import { careVertexModelPath, careVertexWssBase } from '@cureocity/llm';
import { gatewayAccessToken, gatewayGcpProjectId } from './gcp-token';

/**
 * Sprint DS13 — the streaming display rail.
 *
 * Holds ONE Gemini Live socket per consult and feeds it the same 16 kHz PCM
 * the windowed pipeline gets, purely to surface `input_transcription`
 * fragments sub-second. DISPLAY-ONLY by design: nothing downstream consumes
 * this text — the windowed Pass-1 rail stays the authoritative, diarized,
 * citation-gated record. Consequently every failure mode here degrades to
 * "the provisional line stops updating": errors never surface to the doctor
 * and never touch the consult pipeline.
 *
 * Cost posture (why this is safe to run): the setup requests
 * `context_window_compression: { sliding_window: {} }` so a long consult
 * never re-bills its whole history per turn, and `session_resumption` +
 * capped reconnect backoff ride out Indian clinic Wi-Fi (the Care recipe's
 * §4.7 resilience, reused verbatim).
 *
 * ENABLEMENT IS GATED — see streamTranscriptConfig(): the flag defaults OFF
 * and the probe (scripts/doctor-live-transcript-probe.mjs) must confirm the
 * region/model pair first. The probe-confirmed Vertex Live models currently
 * reach setupComplete in us-central1/us-east4 only (NOT asia-south1), so
 * turning this on is a DPDP/cross-border decision, not just an env var.
 */

export interface StreamTranscriberHandle {
  feed(pcm: Buffer): void;
  stop(): void;
}

export interface StreamTranscriberOptions {
  sessionId: string;
  /** Fully-resolved wss URL (with auth) — re-invoked on every (re)connect. */
  wsUrl: () => Promise<string | null>;
  /** The `{ setup: ... }` first message. `session_resumption.handle` is merged in on resumes. */
  setup: Record<string, unknown>;
  /** A transcription fragment to append to the provisional display line. */
  onPartial: (fragment: string) => void;
  /** The rail is permanently down for this consult (already logged). */
  onDown?: (reason: string) => void;
  /** Test seam — construct the socket. */
  wsFactory?: (url: string) => WebSocket;
  /** Consecutive failed connects before giving up. */
  maxAttempts?: number;
  /** Base reconnect delay (doubles per consecutive failure). */
  baseDelayMs?: number;
}

/** Bound the pre-setup audio queue to ~10s — display-only, drop-oldest. */
const MAX_QUEUED_BYTES = 320_000;

export class LiveStreamTranscriber implements StreamTranscriberHandle {
  private ws: WebSocket | null = null;
  private ready = false;
  private stopped = false;
  private down = false;
  private attempts = 0;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private resumeHandle: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: StreamTranscriberOptions) {}

  start(): void {
    void this.connect();
  }

  feed(pcm: Buffer): void {
    if (this.stopped || this.down || pcm.length === 0) return;
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.sendAudio(pcm);
      return;
    }
    // Not connected yet (or mid-reconnect) — keep a bounded rolling tail.
    this.queue.push(pcm);
    this.queuedBytes += pcm.length;
    while (this.queuedBytes > MAX_QUEUED_BYTES && this.queue.length > 1) {
      const dropped = this.queue.shift()!;
      this.queuedBytes -= dropped.length;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.queue = [];
    this.queuedBytes = 0;
    try {
      this.ws?.close(1000, 'consult finalized');
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.down) return;
    let url: string | null = null;
    try {
      url = await this.opts.wsUrl();
    } catch (e) {
      console.warn(`[stream-transcript] ${this.opts.sessionId} url/token failed:`, e);
    }
    if (!url) {
      this.failed('no credential/url for the streaming socket');
      return;
    }

    const make = this.opts.wsFactory ?? ((u: string) => new WebSocket(u));
    let ws: WebSocket;
    try {
      ws = make(url);
    } catch (e) {
      console.warn(`[stream-transcript] ${this.opts.sessionId} socket construct failed:`, e);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.ready = false;

    ws.on('open', () => {
      // §4.3 — the setup is the FIRST message; audio only after setupComplete.
      const setup = this.opts.setup['setup'] as Record<string, unknown> | undefined;
      const withResume = this.resumeHandle
        ? { setup: { ...setup, session_resumption: { handle: this.resumeHandle } } }
        : this.opts.setup;
      ws.send(JSON.stringify(withResume));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return; // an old socket closing late
      this.ws = null;
      const wasReady = this.ready;
      this.ready = false;
      if (this.stopped) return;
      if (!wasReady) {
        // Closed before setupComplete → auth/region/model rejection. Log the
        // code so a misconfigured flag is diagnosable from Cloud Run logs.
        console.warn(
          `[stream-transcript] ${this.opts.sessionId} closed pre-setup code=${code} reason=${String(reason)}`,
        );
      }
      this.scheduleReconnect();
    });

    ws.on('error', (e: Error) => {
      console.warn(`[stream-transcript] ${this.opts.sessionId} socket error: ${e.message}`);
      // 'close' follows and drives the reconnect.
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if ('setupComplete' in msg || 'setup_complete' in msg) {
      this.ready = true;
      this.attempts = 0; // a successful setup resets the failure budget
      for (const pcm of this.queue) this.sendAudio(pcm);
      this.queue = [];
      this.queuedBytes = 0;
      return;
    }
    // Both snake_case (raw API) and camelCase (SDK-shaped) — same defence
    // as the Care client.
    const resume = (msg['sessionResumptionUpdate'] ?? msg['session_resumption_update']) as
      | { newHandle?: string; new_handle?: string; resumable?: boolean }
      | undefined;
    if (resume) {
      const handle = resume.newHandle ?? resume.new_handle;
      if (handle && resume.resumable !== false) this.resumeHandle = handle;
    }
    if ('goAway' in msg || 'go_away' in msg) {
      // The server is about to drop us — reconnect proactively (the resume
      // handle carries the session).
      try {
        this.ws?.close(1000, 'goAway');
      } catch {
        /* ignore */
      }
      return;
    }
    const sc = (msg['serverContent'] ?? msg['server_content']) as
      | Record<string, unknown>
      | undefined;
    if (!sc) return;
    const inT = (sc['input_transcription'] ?? sc['inputTranscription']) as
      | { text?: string }
      | undefined;
    if (inT?.text) this.opts.onPartial(inT.text);
    // modelTurn / output transcription are deliberately ignored — the setup
    // instructs the model to stay silent and we only want the input rail.
  }

  private sendAudio(pcm: Buffer): void {
    try {
      this.ws?.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [{ mime_type: 'audio/pcm;rate=16000', data: pcm.toString('base64') }],
          },
        }),
      );
    } catch (e) {
      console.warn(`[stream-transcript] ${this.opts.sessionId} send failed:`, e);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.down) return;
    this.attempts += 1;
    const max = this.opts.maxAttempts ?? 5;
    if (this.attempts > max) {
      this.failed(`gave up after ${max} consecutive failed connects`);
      return;
    }
    const delay = (this.opts.baseDelayMs ?? 750) * 2 ** (this.attempts - 1);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private failed(reason: string): void {
    if (this.down) return;
    this.down = true;
    this.queue = [];
    this.queuedBytes = 0;
    console.warn(
      `[stream-transcript] ${this.opts.sessionId} streaming rail DOWN (${reason}) — windowed transcript continues unaffected`,
    );
    this.opts.onDown?.(reason);
  }
}

// ---------------------------------------------------------------------------
// Enablement + setup

export interface StreamTranscriptConfig {
  location: string;
  model: string;
}

/**
 * The streaming rail is OFF unless explicitly enabled. Before setting the
 * flag in an environment, run scripts/doctor-live-transcript-probe.mjs with
 * that environment's credentials to confirm the (location, model) pair
 * reaches setupComplete and emits input_transcription — and clear the
 * cross-border/DPDP question if the confirmed region is outside India.
 */
export function streamTranscriptConfig(
  env: Record<string, string | undefined>,
): StreamTranscriptConfig | null {
  if (env['LIVE_STREAM_TRANSCRIPT'] !== 'true') return null;
  return {
    location: env['LIVE_STREAM_LOCATION'] ?? 'us-central1',
    model: env['LIVE_STREAM_MODEL'] ?? 'gemini-live-2.5-flash',
  };
}

/** The transcription-only Live setup (no voice, no dialog — just ears). */
export function buildStreamSetup(
  projectId: string,
  config: StreamTranscriptConfig,
): Record<string, unknown> {
  return {
    setup: {
      model: careVertexModelPath(projectId, config.location, config.model),
      generation_config: {
        response_modalities: ['TEXT'],
        temperature: 0,
        max_output_tokens: 1,
      },
      system_instruction: {
        parts: [
          {
            text: 'You are a silent transcription tap. Never answer, comment, or translate. Produce no output.',
          },
        ],
      },
      realtime_input_config: {
        automatic_activity_detection: {
          disabled: false,
          start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
          end_of_speech_sensitivity: 'END_SENSITIVITY_LOW',
          silence_duration_ms: 400,
        },
      },
      input_audio_transcription: {},
      // §4.7 resilience — resumption handles + sliding-window compression:
      // survives network blips AND caps the per-turn context re-billing that
      // would otherwise make a long consult expensive.
      session_resumption: {},
      context_window_compression: { sliding_window: {} },
    },
  };
}

/** Build a ready-to-start transcriber for one consult, or null when disabled/uncredentialed. */
export function makeStreamTranscriber(args: {
  sessionId: string;
  env: Record<string, string | undefined>;
  onPartial: (fragment: string) => void;
  onDown?: (reason: string) => void;
}): LiveStreamTranscriber | null {
  const config = streamTranscriptConfig(args.env);
  if (!config) return null;
  const projectId = gatewayGcpProjectId();
  if (!projectId) {
    console.warn('[stream-transcript] enabled but no GCP project id — rail disabled');
    return null;
  }
  const setup = buildStreamSetup(projectId, config);
  return new LiveStreamTranscriber({
    sessionId: args.sessionId,
    setup,
    wsUrl: async () => {
      const token = await gatewayAccessToken();
      if (!token) return null;
      return `${careVertexWssBase(config.location)}?access_token=${encodeURIComponent(token.token)}`;
    },
    onPartial: args.onPartial,
    ...(args.onDown && { onDown: args.onDown }),
  });
}
