import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { LiveGatewayCommandSchema, type LiveGatewayEvent } from '@cureocity/contracts';
import { authRequired, verifyStartToken } from './auth';
import { buildBackends } from './llm';
import { LiveSession } from './live-session';

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

const backends = buildBackends();
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  send(ws, { type: 'status', state: 'connected' });
  let session: LiveSession | null = null;

  ws.on('message', (raw: RawData, isBinary: boolean) => {
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
      session?.dispose();
      session = new LiveSession(
        cmd.sessionId ?? `live-${Date.now()}`,
        cmd.specialty ?? null,
        backends,
        (event) => send(ws, event),
      );
      session.start();
    } else if (cmd.type === 'stop') {
      void session?.finalize();
    }
  });

  ws.on('close', () => session?.dispose());
  ws.on('error', () => session?.dispose());
});

console.log(
  `[live-gateway] streaming gateway listening on ws://localhost:${PORT} (LLM_BACKEND=${backends.backend}, auth=${authRequired() ? 'required' : 'open (dev)'})`,
);

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
