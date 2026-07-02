# Runbook — deploy the live-copilot gateway (asia-south1)

**Scope:** stand up (or restart) the standalone WebSocket gateway that
powers the doctor live copilot, in-region, with TLS + auth. Vercel
serverless cannot hold a socket, so the live path (`services/live-gateway`)
runs as its own always-on service. The app talks to it over `wss://`.

This is the remaining **ops** step of Sprint DS8. The code, container,
health check, concurrency cap, and auth are shipped; this runbook is how an
operator turns them into a running prod endpoint.

## What it does

- Accepts a browser WebSocket, receives streamed PCM audio, runs the real
  pipeline (Pass 1 transcript → Pass 2 note → reasoning/gaps), streams the
  rails back. No database access — the browser relays anything that
  persists (meter, note) to `apps/web`.
- `GET /healthz` → `{ status, backend, activeSessions, maxSessions, authRequired }`.
- Sheds new sessions past `LIVE_GATEWAY_MAX_SESSIONS` (default 50) with a
  `busy` status (§0.3: ≥ 50 concurrent/node).

## 1. Environment

Set on the **gateway** service:

| Var                         | Value                    | Notes                           |
| --------------------------- | ------------------------ | ------------------------------- |
| `LLM_BACKEND`               | `vertex`                 | `mock` only for smoke           |
| `VERTEX_PROJECT_ID`         | your GCP project         |                                 |
| `VERTEX_FLASH_REGION`       | `asia-south1`            | Pass 1 residency (audio)        |
| `LIVE_GATEWAY_SECRET`       | a 32+ byte random secret | **required in prod** (auth)     |
| `LIVE_GATEWAY_MAX_SESSIONS` | `50` (tune to the node)  | concurrency cap                 |
| `LIVE_GATEWAY_PORT`         | `8787`                   | behind the TLS proxy            |
| `NODE_ENV`                  | `production`             | enables the fail-closed warning |

Set on the **app** (Vercel prod):

| Var                            | Value                             | Notes                                |
| ------------------------------ | --------------------------------- | ------------------------------------ |
| `NEXT_PUBLIC_LIVE_GATEWAY_URL` | `wss://gateway.mind.cureocity.in` | the public wss endpoint              |
| `LIVE_GATEWAY_SECRET`          | **same secret as the gateway**    | the app mints the signed start token |

The secret MUST match on both sides — the app signs the start token
(`apps/web/lib/live-token.ts`), the gateway verifies it (`src/auth.ts`).
If it's unset on the gateway in prod, it logs a loud OPEN warning and
accepts anyone who can reach the socket — do not ship that.

## 2. Build + run (container)

```bash
# from the repo root (the workspace lockfile lives there)
docker build -f services/live-gateway/Dockerfile -t cureocity-live-gateway .
docker run -d --name live-gateway -p 8787:8787 \
  -e LLM_BACKEND=vertex -e VERTEX_PROJECT_ID=... -e VERTEX_FLASH_REGION=asia-south1 \
  -e LIVE_GATEWAY_SECRET=... -e NODE_ENV=production \
  cureocity-live-gateway
curl -s http://localhost:8787/healthz | jq
```

### VM + systemd (the plan's default — a GCE VM in asia-south1)

`/etc/systemd/system/live-gateway.service`:

```ini
[Unit]
Description=Cureocity live-copilot gateway
After=network.target

[Service]
ExecStart=/usr/bin/docker run --rm --name live-gateway -p 8787:8787 --env-file /etc/live-gateway.env cureocity-live-gateway
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now live-gateway`. `Restart=always` covers crashes.

### TLS / `wss://`

Terminate TLS at a reverse proxy in front of `:8787` and proxy the
WebSocket upgrade through. Caddy (auto-cert) is the least-effort:

```
gateway.mind.cureocity.in {
  reverse_proxy 127.0.0.1:8787
}
```

Cloud Run is an alternative (native TLS + WebSocket support + autoscale);
if used, set `--min-instances=1` (cold starts drop sockets) and keep the
same env. The concurrency cap still applies per instance.

## 3. Verify

1. `curl https://gateway.mind.cureocity.in/healthz` → `authRequired: true`,
   `backend: "vertex"`.
2. In the app (doctor account) open a patient → **Start consult**, speak a
   sentence, confirm the transcript + note + copilot rails populate.
3. Watch `activeSessions` climb in `/healthz` during the consult and fall
   after End.
4. Load: script ≥ 50 concurrent mock clients against a staging node;
   confirm existing sessions are unaffected and the 51st gets `busy`.

## 4. DPDP checklist (confirm at deploy)

- **No audio at rest.** The gateway processes PCM in memory per window and
  discards it; it never writes audio to disk or a bucket. Verify: no
  volume mounts for audio, no S3/GCS writes in `services/live-gateway`.
- **Audio residency = asia-south1.** Pass 1 (audio → transcript) runs in
  `VERTEX_FLASH_REGION=asia-south1`. Confirm the value is set.
- **Transcript residency.** Confirm the note (Pass 2) + reasoning model
  regions are also asia-south1 for full in-region processing; if any pass
  routes to a global endpoint, record it as a documented cross-border
  transfer in `docs/dpdp-data-flow.md` before pilot.
- **Transport.** `wss://` only (TLS); no plaintext `ws://` reachable from
  the public internet.

## 5. Rollback / restart

- Restart: `systemctl restart live-gateway` (or redeploy the Cloud Run
  revision). In-flight consults drop their socket; the doctor presses Start
  again (the note draft up to that point is already relayed).
- Bad build: `docker run` the previous image tag; health check gates the LB.
- Auth incident: rotate `LIVE_GATEWAY_SECRET` on **both** the gateway and
  the app together (a mismatch rejects every start with `unauthorized`).
