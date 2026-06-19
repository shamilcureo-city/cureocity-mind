# @cureocity/live-gateway

Sprint DV4 — the **WebSocket streaming gateway** for the doctor live
copilot. Vercel serverless can't hold a socket, so the live path runs as
its own (in-region, for DPDP) service rather than a Next.js route.

This build is the **mock driver**: on `start` it replays a scripted
Hinglish cardiology OPD consult, streaming the three rails — live
transcript (Rail 1), a note that fills in as it goes (Rail 2), and
gap / red-flag nudges (Rail 3) — and a final note on `stop`. It needs no
GCP creds and no audio, so the whole live UX runs locally.

## Run it

```bash
pnpm --filter @cureocity/live-gateway dev   # ws://localhost:8787
```

Then open a doctor encounter in the web app and click **Try the live
copilot (preview)**. Point the web app at the gateway with
`NEXT_PUBLIC_LIVE_GATEWAY_URL` (defaults to `ws://localhost:8787`).

## Wire protocol

Shared, validated schemas live in `@cureocity/contracts`
(`live-encounter.ts`):

- Client → gateway: `LiveGatewayCommand` (`start` / `stop`)
- Gateway → client: `LiveGatewayEvent` (`status` / `transcript` / `note`
  / `gap` / `final`)

## What's next (real path)

Swap the mock driver for: a streaming ASR (Rail 1, Indic/code-mix), a
debounced structurer over the rolling transcript (Rail 2), and a
gap/red-flag pass (Rail 3); persist the final note through the existing
medical-note pipeline. Pick the ASR engine + confirm asia-south1
residency first (see `docs/DOCTOR_VERTICAL.md` §4.3, §14).
