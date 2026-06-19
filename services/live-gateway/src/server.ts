import { WebSocketServer, type WebSocket } from 'ws';
import type { LiveGatewayCommand, LiveGatewayEvent } from '@cureocity/contracts';
import { MockConsultDriver } from './mock-consult';

/**
 * Sprint DV4 — the live copilot's streaming gateway (MOCK).
 *
 * The doctor's browser opens a WebSocket here and receives the three
 * rails (transcript / building note / gaps) + a final note. Vercel
 * serverless can't hold a socket, so this is a standalone in-region
 * service. This MOCK build replays a scripted Hinglish OPD consult — the
 * real path swaps in a streaming ASR (Rail 1), a debounced structurer
 * (Rail 2), and a gap/red-flag pass (Rail 3). See docs/DOCTOR_VERTICAL.md.
 */
const PORT = Number(process.env['LIVE_GATEWAY_PORT'] ?? 8787);

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  send(ws, { type: 'status', state: 'connected' });
  let driver: MockConsultDriver | null = null;

  ws.on('message', (raw: Buffer) => {
    let cmd: LiveGatewayCommand;
    try {
      cmd = JSON.parse(raw.toString()) as LiveGatewayCommand;
    } catch {
      return;
    }
    if (cmd.type === 'start') {
      driver?.dispose();
      driver = new MockConsultDriver((event) => send(ws, event));
      driver.start();
    } else if (cmd.type === 'stop') {
      driver?.finalize();
    }
  });

  ws.on('close', () => driver?.dispose());
  ws.on('error', () => driver?.dispose());
});

console.log(`[live-gateway] mock streaming gateway listening on ws://localhost:${PORT}`);

function send(ws: WebSocket, event: LiveGatewayEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}
