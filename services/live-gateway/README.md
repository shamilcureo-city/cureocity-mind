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

## Wire protocol

Shared, validated schemas live in `@cureocity/contracts`
(`live-encounter.ts`):

- Client → gateway: a JSON `LiveGatewayCommand` (`start` / `stop`), plus
  **binary** messages carrying streamed PCM audio frames while listening.
- Gateway → client: `LiveGatewayEvent` (`status` / `transcript` / `note`
  / `gap` / `final`).

## What's next (latency)

The clinical substance is real today; the remaining optimisation is
true token-streaming ASR (so Rail 1 updates word-by-word instead of on
the rolling-window cadence) and persisting the final note through the
existing medical-note route. Confirm the streaming-ASR engine +
asia-south1 residency first (see `docs/DOCTOR_VERTICAL.md` §4.3, §14).
