# @cureocity/live-gateway

Sprint DV4 — the **WebSocket streaming gateway** for the doctor live
copilot. Vercel serverless can't hold a socket, so the live path runs as
its own (in-region, for DPDP) service rather than a Next.js route.

This runs the **real pipeline**, not a script. The browser streams raw
PCM audio frames (16 kHz mono s16le) over the socket; on a fixed cadence
the gateway runs the same proven passes the batch path uses:

- **Rail 1** — Pass 1 (transcription) over the rolling audio buffer → the
  growing transcript.
- **Rail 2** — Pass 2 with `vertical=DOCTOR` → `MedicalEncounterNoteV1`,
  the note building itself.
- **Rail 3** — the deterministic gap / red-flag engine (`gaps.ts`) over
  the transcript + the building note.

`LLM_BACKEND=mock` (default) runs locally with deterministic backends and
no GCP creds — the whole live UX works offline. `LLM_BACKEND=vertex`
makes it genuinely real: real audio → real Vertex transcription (Pass 1
in asia-south1 for DPDP residency) → real Gemini note → real flags.

## Run it

```bash
# local, no creds:
pnpm --filter @cureocity/live-gateway dev          # ws://localhost:8787

# real:
LLM_BACKEND=vertex VERTEX_PROJECT_ID=... \
  GOOGLE_APPLICATION_CREDENTIALS=... \
  pnpm --filter @cureocity/live-gateway dev
```

Then open a doctor encounter in the web app and click **Try the live
copilot**. Point the web app at the gateway with
`NEXT_PUBLIC_LIVE_GATEWAY_URL` (defaults to `ws://localhost:8787`).

## Deploying (Cloud Run) — the settings that decide whether consults survive

A consult's whole state (audio buffer, transcript, CaseState) lives in
**this process's memory** until it emits `final`. The Cloud Run defaults
are wrong for that, in ways that silently destroy encounters:

```bash
gcloud run deploy cureocity-live-gateway \
  --region=asia-south1 \
  --timeout=3600 \                  # default 300s = a consult is killed at 5 min
  --min-instances=1 \               # a cold start drops the socket mid-consult
  --max-instances=10 \
  --cpu=2 --memory=2Gi \
  --cpu-always-allocated \          # the pump ticks between requests
  --concurrency=80 \
  --set-env-vars=LLM_BACKEND=vertex,VERTEX_PROJECT_ID=...
```

Why each one matters:

| Flag                     | Default | Why the default breaks consults                                                                                               |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--timeout`              | 300s    | A WebSocket **is** a request. At 5 minutes Cloud Run kills it mid-consult. 3600 covers the longest OPD encounter.             |
| `--min-instances`        | 0       | Scale-to-zero means the next consult pays a cold start, and an idle instance is reclaimed **while a doctor is mid-sentence**. |
| `--cpu-always-allocated` | off     | The 1s `pump()` tick is not request-driven work; throttled CPU stalls transcription between frames.                           |

The service handles `SIGTERM` by **draining**: it stops accepting new
consults and attempts to finalize active ones before exiting. Intentional
pauses are not automatically finalized. `LIVE_GATEWAY_DRAIN_TIMEOUT_MS`
(default 25s) is an application budget, not an extension of the platform's
shutdown grace; the request `--timeout` does not change that grace either.
Use a quiet deployment window. Reconnect can replay acknowledged transcript
(`start.resume`), but cannot guarantee recovery of unacknowledged audio.

Authenticated sessions also require
`LIVE_AUTHZ_REVALIDATE_URL=https://<app-host>/api/v1/internal/live-authority`.
The app and gateway share `LIVE_GATEWAY_SECRET` for this service call. The
gateway verifies current practitioner status and capabilities before starting,
every five seconds, and immediately before regulated output. A denial, timeout,
or verifier outage closes the socket rather than continuing from stale token
claims. Tune only with `LIVE_AUTHZ_INTERVAL_MS` (default 5000) and
`LIVE_AUTHZ_TIMEOUT_MS` (default 2000).
Production accepts only an HTTPS verifier URL with the exact internal endpoint
path and refuses redirects. Keep the timeout shorter than the interval. Set the
same secret on Vercel (`apps/web`) and Cloud Run (`live-gateway`), never in a
`NEXT_PUBLIC_*` variable.

## Wire protocol

Shared, validated schemas live in `@cureocity/contracts`
(`live-encounter.ts`):

- Client → gateway: a JSON `LiveGatewayCommand` (`start` / `stop` / `pause` /
  `renewToken`), plus
  **binary** messages carrying streamed PCM audio frames while listening.
- Gateway → client: `LiveGatewayEvent` (`status` / `transcript` / `note`
  / `gap` / `final`).

### Long sessions and short-lived authorization

Mind and Scribe retain five-minute signed tokens. Each connected client requests
a fresh token before expiry and sends `renewToken` with a UUID request ID. The
gateway checks signature, unchanged session/practitioner/vertical, a later expiry,
and current server-side consent/capabilities before replying `tokenRenewed` with
the same ID and accepted expiry. This changes only the authorization deadline:
the existing audio buffer, transcript, elapsed time, and billing state remain.

The old deadline stays enforced while renewal is pending. A failed mint, missing
acknowledgement, revoked authority, or expired lease stops capture and requires
explicit recovery. Late replies cannot revive stopped or replaced sockets.
Renewal never starts a paused microphone. Stop and shutdown prevent further
renewal while allowing still-authorized finalization work.

Authorization-only renewal runs independently of the ordered audio/Pause queue,
so a slow final transcription cannot consume the client's renewal-ACK deadline.
This does not bypass current consent, identity matching, the old expiry, or
Stop/shutdown fences. Pause still processes preceding audio in order and sends
`capturePaused` only after its captured utterances have been forwarded.

A pause attempt has a 25-second gateway reply budget. A timeout reports
`capturePauseFailed`, keeps capture off, and leaves the existing tail worker in
ownership of its bytes. An explicit retry joins that worker rather than
transcribing the same audio twice. Large tails use the normal bounded audio
windows. Late completion can add captured words but cannot turn a failed attempt
into a successful pause without a new request. An End that cannot safely join
the paused audio closes for captured-transcript recovery rather than publishing
an incomplete final note. Untranscribed audio is not guaranteed recoverable.

The web client stops physical tracks before best-effort audio-context release;
context cleanup is bounded separately from the final-frame acknowledgement.
Control timing logs contain only command kind, validated request ID, phase and
elapsed milliseconds, not clinical data or credentials.

Deploy the matching gateway and web clients in a quiet window. Stage the new
gateway revision without traffic, verify its image digest and readiness, and
coordinate the traffic switch with the web release. An older gateway cannot
acknowledge renewal, and an older client cannot request it. Health checks alone
do not prove renewal or Pause/Resume behavior; validate with a fictional session
longer than five minutes before using real patient sessions.

## What's next (latency)

The clinical substance is real today; the remaining optimisation is
true token-streaming ASR (so Rail 1 updates word-by-word instead of on
the rolling-window cadence) and persisting the final note through the
existing medical-note route. Confirm the streaming-ASR engine +
asia-south1 residency first (see `docs/DOCTOR_VERTICAL.md` §4.3, §14).
