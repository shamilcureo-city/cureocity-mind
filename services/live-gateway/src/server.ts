import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { LiveGatewayCommandSchema, type LiveGatewayEvent } from '@cureocity/contracts';
import { authRequired, isFailClosedMisconfig, verifyStartToken } from './auth';
import { buildBackends } from './llm';
import { LiveSession } from './live-session';
import { GatewayPool, maxSessionsFromEnv } from './pool';
import { windowOptionsFromEnv } from './vad';

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

const backends = buildBackends();
// Sprint DS8 — concurrent-session cap (graceful shed above it).
const pool = new GatewayPool(maxSessionsFromEnv());

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

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  // DOC-4 — reject new sockets past the hard connection cap so pre-start
  // connections can't exhaust the node (independent of the session pool).
  if (wss.clients.size > MAX_CONNECTIONS) {
    send(ws, { type: 'status', state: 'busy' });
    ws.close();
    return;
  }
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
      // Sprint DV8 hardening — verify the practitioner token before
      // streaming (no-op in dev when LIVE_GATEWAY_SECRET is unset).
      if (!verifyStartToken(cmd.token, cmd.sessionId)) {
        send(ws, { type: 'status', state: 'unauthorized' });
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
      session?.dispose();
      session = new LiveSession(
        cmd.sessionId ?? `live-${Date.now()}`,
        cmd.specialty ?? null,
        backends,
        (event) => send(ws, event),
        windowOptionsFromEnv(), // Sprint 74 — latency-tuned, env-overridable
        cmd.context, // Sprint DS1 — seed the CaseState's patient context
        undefined, // noteRefreshMs — the constructor picks the per-vertical default
        cmd.vertical ?? 'DOCTOR', // Sprint TS1 — therapist live scribe support
        cmd.kind ?? 'TREATMENT',
        cmd.modality ?? null,
      );
      session.start();
      started = true;
      armIdle(IDLE_TIMEOUT_MS);
    } else if (cmd.type === 'stop') {
      void session?.finalize();
    } else if (cmd.type === 'dismiss') {
      // Sprint DS3 — the doctor dismissed an ask-next question.
      session?.dismissQuestion(cmd.questionId);
    }
  });

  ws.on('close', () => {
    clearTimeout(idleTimer);
    session?.dispose();
    release();
  });
  ws.on('error', () => {
    clearTimeout(idleTimer);
    session?.dispose();
    release();
  });
});

httpServer.listen(PORT, () => {
  console.log(
    `[live-gateway] listening on :${PORT} (ws + GET /healthz) — LLM_BACKEND=${backends.backend}, auth=${authRequired() ? 'required' : 'open (dev)'}, maxSessions=${pool.max}`,
  );
});

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
