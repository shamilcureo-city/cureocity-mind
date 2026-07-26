import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { LiveGatewayCommandSchema, type LiveGatewayEvent } from '@cureocity/contracts';
import {
  authRequired,
  extractVerifiedClaims,
  isFailClosedMisconfig,
  verifyStartToken,
} from './auth';
import { buildBackends } from './llm';
import { LiveSession } from './live-session';
import { GatewayPool, maxSessionsFromEnv } from './pool';
import { initSentry } from './sentry';
import { makeStreamTranscriber } from './stream-transcript';
import { ledgerFromEnv } from './tenant-spend';
import { windowOptionsFromEnv } from './vad';

// Error reporting first — init before any pipeline construction so a
// boot-time failure (e.g. the mock-refusal guard) is captured too.
initSentry();

/**
 * Sprint DV4 (full) — the live copilot's streaming gateway.
 *
 * The doctor's browser opens a WebSocket here and:
 *   • sends a JSON {type:'start'} command,
 *   • streams raw PCM audio frames as BINARY messages (16 kHz mono s16le),
 *   • sends {type:'stop'} when the consult ends.
 *
 * The gateway runs the real pipeline (LiveSession: Pass 1 transcription +
 * Pass 2 medical note + the gap engine) and streams back the three rails
 * (transcript / building note / gaps) + a final note. Vercel serverless
 * can't hold a socket, so this is a standalone in-region service.
 *
 * LLM_BACKEND=mock runs locally with no creds; LLM_BACKEND=vertex makes
 * it real (asia-south1 Pass 1 for DPDP residency). See
 * docs/DOCTOR_VERTICAL.md §4 + services/live-gateway/README.md.
 */
const PORT = Number(process.env['LIVE_GATEWAY_PORT'] ?? 8787);
// DOC-4 — a socket only takes a session-pool slot on a valid `start`, so
// pre-start connections were unbounded. Cap total concurrent sockets, and
// close any that connect but never send a valid `start` (or go silent).
const MAX_CONNECTIONS = Number(process.env['LIVE_GATEWAY_MAX_CONNECTIONS'] ?? 200);
const STARTUP_GRACE_MS = Number(process.env['LIVE_GATEWAY_STARTUP_GRACE_MS'] ?? 60_000);
const IDLE_TIMEOUT_MS = Number(process.env['LIVE_GATEWAY_IDLE_TIMEOUT_MS'] ?? 300_000);
// Batch A — how long a SIGTERM drain waits for live consults to finalize
// before force-exiting. Cloud Run's default grace is 10s; set
// `--timeout`/terminationGracePeriod ≥ this (see the deploy notes in README).
const DRAIN_TIMEOUT_MS = Number(process.env['LIVE_GATEWAY_DRAIN_TIMEOUT_MS'] ?? 25_000);
// Batch A — every LiveSession currently streaming, so a drain can finalize
// them all. Registered on start, removed on dispose/close.
const liveSessions = new Set<LiveSession>();

const backends = buildBackends();
// Sprint DS8 — concurrent-session cap (graceful shed above it).
const pool = new GatewayPool(maxSessionsFromEnv());
// NEXT4 — per-tenant daily INR circuit breaker. The per-consult ceiling
// bounds one runaway consult; this bounds a runaway day (looped consults,
// replayed tokens). New starts over the cap are shed as `busy`; a consult
// already streaming always finishes. In-memory, per-instance, IST day.
const tenantSpend = ledgerFromEnv();

// Sprint DS8 — a plain HTTP server hosts the health endpoint AND upgrades
// to WebSocket, so a load balancer / systemd can probe liveness + readiness.
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        backend: backends.backend,
        activeSessions: pool.active,
        maxSessions: pool.max,
        authRequired: authRequired(),
      }),
    );
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// AUD2 — bound a single frame to a small multiple of the expected PCM window
// (the browser sends ~64 KB frames; 256 KB is generous). The ws default is
// 100 MB, which is a memory-DoS invitation on a public socket.
const MAX_WS_FRAME_BYTES = Number(process.env['LIVE_GATEWAY_MAX_FRAME_BYTES'] ?? 256 * 1024);
// AUD2 — per-IP connection ceiling so one client can't consume the whole
// global MAX_CONNECTIONS pool before auth ever runs.
const MAX_CONNECTIONS_PER_IP = Number(process.env['LIVE_GATEWAY_MAX_CONNECTIONS_PER_IP'] ?? 10);
const connectionsByIp = new Map<string, number>();

function clientIp(req: import('node:http').IncomingMessage): string {
  // Cloud Run fronts us with a proxy — first hop of x-forwarded-for is the
  // caller. Fall back to the socket address for direct/local connections.
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_WS_FRAME_BYTES });

wss.on('connection', (ws, req) => {
  // DOC-4 — reject new sockets past the hard connection cap so pre-start
  // connections can't exhaust the node (independent of the session pool).
  if (wss.clients.size > MAX_CONNECTIONS) {
    send(ws, { type: 'status', state: 'busy' });
    ws.close();
    return;
  }
  // AUD2 — per-IP ceiling (see above). Counted before any protocol work.
  const ip = clientIp(req);
  const ipCount = (connectionsByIp.get(ip) ?? 0) + 1;
  if (ipCount > MAX_CONNECTIONS_PER_IP) {
    send(ws, { type: 'status', state: 'busy' });
    ws.close();
    return;
  }
  connectionsByIp.set(ip, ipCount);
  let ipReleased = false;
  const releaseIp = (): void => {
    if (ipReleased) return;
    ipReleased = true;
    const n = (connectionsByIp.get(ip) ?? 1) - 1;
    if (n <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, n);
  };
  ws.on('close', releaseIp);
  ws.on('error', releaseIp);
  send(ws, { type: 'status', state: 'connected' });
  let session: LiveSession | null = null;
  let started = false;
  // Sprint DS8 — one pool slot per connection, taken on the first start,
  // returned exactly once on close/error.
  let acquired = false;
  const release = (): void => {
    if (acquired) {
      pool.release();
      acquired = false;
    }
  };

  // DOC-4 — close a socket that connects but never sends a valid `start`
  // within the grace window, or that goes silent mid-consult.
  let idleTimer: NodeJS.Timeout;
  const armIdle = (ms: number): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }, ms);
  };
  armIdle(STARTUP_GRACE_MS);

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    armIdle(started ? IDLE_TIMEOUT_MS : STARTUP_GRACE_MS);
    // Binary frames are streamed PCM audio for the active session.
    if (isBinary) {
      session?.pushAudio(toBuffer(raw));
      return;
    }
    const parsed = LiveGatewayCommandSchema.safeParse(safeJson(raw));
    if (!parsed.success) return;
    const cmd = parsed.data;
    if (cmd.type === 'start') {
      // Batch A — the node is shutting down; shed the start so the browser
      // retries against a healthy instance instead of streaming into a corpse.
      if (draining) {
        send(ws, { type: 'status', state: 'busy' });
        ws.close();
        return;
      }
      // Sprint DV8 hardening — verify the practitioner token before
      // streaming (no-op in dev when LIVE_GATEWAY_SECRET is unset).
      if (!verifyStartToken(cmd.token, cmd.sessionId)) {
        send(ws, { type: 'status', state: 'unauthorized' });
        ws.close();
        return;
      }
      // NEXT4 — refuse a tenant already over its daily spend cap. Claims
      // are only trusted when HMAC-verified (dev/no-secret → null → open,
      // matching mock's zero cost).
      const claims = extractVerifiedClaims(cmd.token, cmd.sessionId);
      const tenantId = claims?.psychologistId ?? null;
      if (tenantId && tenantSpend.isOverCap(tenantId)) {
        console.warn(`[gateway] tenant ${tenantId} over daily cost cap — shedding start`);
        send(ws, { type: 'status', state: 'busy' });
        ws.close();
        return;
      }
      // Sprint DS8 — shed NEW sessions once the node is at capacity; a
      // consult already streaming keeps its slot.
      if (!acquired) {
        if (!pool.tryAcquire()) {
          send(ws, { type: 'status', state: 'busy' });
          ws.close();
          return;
        }
        acquired = true;
      }
      if (session) {
        liveSessions.delete(session);
        session.dispose();
      }
      // NEXT4 — feed the ledger from meter events. `summary.costInr` is
      // cumulative per consult, so only the delta since the last event is
      // added.
      let lastMeterInr = 0;
      const forward = (event: LiveGatewayEvent): void => {
        if (tenantId && event.type === 'meter') {
          tenantSpend.add(tenantId, event.summary.costInr - lastMeterInr);
          lastMeterInr = Math.max(lastMeterInr, event.summary.costInr);
        }
        send(ws, event);
      };
      session = new LiveSession(
        cmd.sessionId ?? `live-${Date.now()}`,
        cmd.specialty ?? null,
        backends,
        forward,
        windowOptionsFromEnv(), // Sprint 74 — latency-tuned, env-overridable
        cmd.context, // Sprint DS1 — seed the CaseState's patient context
        undefined, // noteRefreshMs — the constructor picks the per-vertical default
        cmd.vertical ?? 'DOCTOR', // Sprint TS1 — therapist live scribe support
        cmd.kind ?? 'TREATMENT',
        cmd.modality ?? null,
        cmd.therapyContext ?? null, // Sprint TS5 — carried questions + prior risk
      );
      // Batch A — a reconnect after a dropped socket replays the transcript the
      // browser still holds, so the consult continues instead of starting blank.
      if (cmd.resume?.utterances.length) {
        session.seedResume(cmd.resume.utterances);
        console.log(
          `[gateway] resumed ${cmd.sessionId ?? '(anon)'} with ${cmd.resume.utterances.length} replayed utterances`,
        );
      }
      // Sprint DS13 — the flag-gated streaming display rail (doctor path
      // only for now). Failures degrade to "provisional line stops
      // updating"; the windowed pipeline is untouched.
      if ((cmd.vertical ?? 'DOCTOR') === 'DOCTOR') {
        const forSession = session;
        const transcriber = makeStreamTranscriber({
          sessionId: cmd.sessionId ?? 'live',
          env: process.env,
          onPartial: (fragment) => forSession.handleStreamPartial(fragment),
        });
        if (transcriber) {
          forSession.attachStreamTranscriber(transcriber);
          transcriber.start();
        }
      }
      session.start();
      liveSessions.add(session);
      started = true;
      armIdle(IDLE_TIMEOUT_MS);
    } else if (cmd.type === 'stop') {
      void session?.finalize();
    } else if (cmd.type === 'dismiss') {
      // Sprint DS3 — the doctor dismissed an ask-next question.
      session?.dismissQuestion(cmd.questionId);
    } else if (cmd.type === 'refreshNote') {
      // Sprint TS-B3 — "Update now" on the live note panel.
      session?.requestNoteRefresh();
    }
  });

  const teardown = (): void => {
    clearTimeout(idleTimer);
    if (session) {
      liveSessions.delete(session);
      session.dispose();
    }
    release();
  };
  ws.on('close', teardown);
  ws.on('error', teardown);
});

httpServer.listen(PORT, () => {
  console.log(
    `[live-gateway] listening on :${PORT} (ws + GET /healthz) — LLM_BACKEND=${backends.backend}, auth=${authRequired() ? 'required' : 'open (dev)'}, maxSessions=${pool.max}`,
  );
});

// Batch A — GRACEFUL DRAIN. Cloud Run sends SIGTERM on a revision swap, a
// scale-down, or an instance recycle. Without a handler the process died
// instantly and every consult streaming through it lost its transcript (the
// gateway holds the only copy until `final`). Now: stop accepting NEW sockets,
// tell every live consult to finalize (which emits `final` → the browser
// persists the note), and only then exit. The browser's reconnect covers the
// window where a consult can't finish in time.
let draining = false;
function drain(signal: string): void {
  if (draining) return;
  draining = true;
  console.log(`[live-gateway] ${signal} — draining ${liveSessions.size} live consult(s)`);
  // Stop accepting new connections; existing sockets stay open to finish.
  httpServer.close();
  const finals = [...liveSessions].map((s) =>
    s
      .finalize()
      .catch((err: unknown) => console.error('[live-gateway] drain finalize failed', err)),
  );
  const hardStop = setTimeout(() => {
    console.error('[live-gateway] drain timed out — exiting');
    process.exit(0);
  }, DRAIN_TIMEOUT_MS);
  void Promise.all(finals).then(() => {
    clearTimeout(hardStop);
    // Give the socket writes a beat to flush the `final` + `done` frames.
    setTimeout(() => process.exit(0), 1_000);
  });
}
process.on('SIGTERM', () => drain('SIGTERM'));
process.on('SIGINT', () => drain('SIGINT'));

// DOC-4 — fail-closed posture: a DEPLOYED node with no secret REFUSES every
// consult (verifyStartToken returns false in prod) rather than running open to
// anyone who can reach the socket. Keep /healthz up so the operator sees the
// misconfig; warn loudly. Mirrors the app's isAuthBypassed() fail-closed rule.
if (isFailClosedMisconfig()) {
  console.error(
    '[live-gateway] MISCONFIGURED: production with no LIVE_GATEWAY_SECRET — refusing all consults. Set the secret to accept signed start tokens.',
  );
}

function send(ws: WebSocket, event: LiveGatewayEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

function safeJson(raw: RawData): unknown {
  try {
    return JSON.parse(toBuffer(raw).toString('utf8'));
  } catch {
    return null;
  }
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw as ArrayBuffer);
}
