# Runbook — Cureocity Care (the /care AI-therapist surface)

Scope: the live voice loop, Pass 10 reports, the safety machinery, and
the mock stack. Product spec: [`../AI_COUNSELING.md`](../AI_COUNSELING.md).

## Env matrix

| Var                         | Values                                      | Notes                                                                                     |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `CARE_LIVE_BACKEND`         | `mock` (default) \| `ai-studio` \| `vertex` | The live voice loop. `ai-studio` = Gemini Developer API; `vertex` = Vertex AI, in-region. |
| `CARE_LIVE_TOKEN_MODE`      | `ephemeral` (default) \| `url`              | `ai-studio` only. `url` reproduces the source recipe (key in the WSS URL). Fallback only. |
| `GEMINI_API_KEY`            | —                                           | Required for `ai-studio`. Server-side only.                                               |
| `CARE_LIVE_VERTEX_LOCATION` | `us-central1` (default)                     | `vertex` only — the region for the Live socket. Set from the probe (below).               |
| `CARE_LIVE_VERTEX_MODEL`    | (native-audio model)                        | `vertex` only — bare Vertex model id. Set from the probe.                                 |
| `CARE_MOCK_LIVE_URL`        | `ws://localhost:8788`                       | Append `?fixture=crisis` to force the crisis script (CI does this).                       |

`vertex` reuses the SAME service account as the batch passes
(`GOOGLE_APPLICATION_CREDENTIALS_JSON` / `VERTEX_PROJECT_ID`) — no `GEMINI_API_KEY`.

### Turning on `CARE_LIVE_BACKEND=vertex`

1. **Probe first** (native-audio Live availability on Vertex differs by region
   and preview name):
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS_JSON='{…sa json…}' VERTEX_PROJECT_ID=your-project \
     node scripts/care-vertex-live-probe.mjs
   ```
   It opens the Vertex Live socket with browser-style `?access_token=` auth and
   prints which `(region, model)` pairs reach `setupComplete`, plus the exact
   env to set.
2. Set `CARE_LIVE_BACKEND=vertex` + the probe's `CARE_LIVE_VERTEX_LOCATION` /
   `CARE_LIVE_VERTEX_MODEL` in Vercel (Production) and redeploy.
3. If the probe finds nothing: either native-audio Live isn't in those Vertex
   regions yet, or Vertex rejects `?access_token=` browser auth (every fail is a
   close/1008) — in which case browser-direct needs a socket gateway; use
   `ai-studio` in the meantime.

> **Security note.** Browser-direct Vertex hands the browser a **cloud-platform**
> GCP access token (Vertex has no narrower scope). It is short-lived and bounded
> to the single session (`expiresAtMs` = min of session cap and token expiry),
> but it is broader than AI Studio's single-use ephemeral token. Hardening
> follow-ups: a downscoped access-boundary token, or proxy the socket through a
> gateway service (the doctor vertical's pattern) so the token never leaves the
> server. Choose deliberately before scaling.

**The single-use live start-token store is the `CareSession` row itself**
(`startTokenHash` / `startTokenExpiresAt`) — no Redis. It was an in-memory
map that silently failed on multi-instance serverless (token minted on one
lambda, redeemed on another → "start token is invalid, expired, or already
used"); moving it to Postgres made the redeem correct everywhere. `REDIS_URL`
is no longer used by Care.

**Sign-in (phone OTP) isn't in the table above** — it needs the patient
Firebase _client_ keys (`NEXT_PUBLIC_FIREBASE_CLIENT_*`) pointed at the same
project as the server admin. Full setup: [`care-auth-setup.md`](./care-auth-setup.md).

## Model pin rotation (the two-outage lesson)

The Live model is pinned in `packages/llm/src/live/config.ts`
(`CARE_LIVE_MODEL_ID`) — a **dated** id, never `-latest`. To rotate:

1. Point `scripts/live-probe.ts` (AC0 spike deliverable) at the candidate
   model; verify setup→setupComplete, both transcription streams, audio
   out, `flag_crisis` round-trip, and a 10-minute soak (the
   `gemini-3.1-flash-live-preview` failure was a MID-conversation drop —
   short probes pass on broken models).
2. Change the pin in ONE place (`live/config.ts`), deploy to a canary,
   watch `gemini_call_duration_ms{pass="LIVE_CARE_SESSION"}` and WS
   reconnect counters for a day.
3. Never rotate the pin and the prompt version in the same deploy.

## Crisis escalation on-call

`CARE_CRISIS_ESCALATED` audit rows are the source of truth. Every
escalation also sets `CareUser.status = SAFETY_HOLD`.

- Triggers: `keyword_screen` (deterministic, `packages/clinical/src/crisis-screen.ts`),
  `model_tool` (flag_crisis), `user_button` (SOS tap).
- The hold lifts ONLY via `POST /care/safety/resume` (≥12 h old, "safe",
  fewer than 2 crisis events in 30 days). Do NOT lift holds via SQL
  unless legal/clinical asks in writing; audit `CARE_SAFETY_HOLD_LIFTED`
  is written by the route, not by hand.
- Phrase lists are clinician-signed. Adding phrases is safe any time;
  removing one requires clinician sign-off (same rule as the
  reliable-change thresholds).

## Report (Pass 10) failures

Symptoms: report screen stuck on "Writing your report…".

1. `GeminiCallLog` rows with `pass = PASS_10_CARE_REPORT` show the error.
2. The user-facing recovery is already shipped: the report screen offers
   "Generate now" (`POST /care/sessions/:id/report`, 120 s budget) after
   ~20 s of polling.
3. Abandoned sessions (client died mid-call) are finalized by
   `GET /api/v1/cron/care-session-sweeper` — ABORTED + a best-effort
   report from whatever was mirrored. Ensure the cron is scheduled.

## Dev / CI quickstart

```bash
# Terminal 1 — the scripted Gemini Live twin
pnpm --filter @cureocity/care-mock-live start        # ws://localhost:8788

# Terminal 2 — the app (bypass auth engages automatically)
DATABASE_URL=... LLM_BACKEND=mock CARE_LIVE_BACKEND=mock \
  pnpm --filter @cureocity/web dev

# http://localhost:3000/care → demo user (Kavya) walks the full arc:
# onboarding → intake → assessment & plan → treatment → progress.
# Crisis path: CARE_MOCK_LIVE_URL='ws://localhost:8788/?fixture=crisis'
```

## Known-good verification

The arc that must always pass (this is what the pilot checklist runs):
onboarding → INTAKE live session (setupComplete gate, audio, mirrored
turns) → Pass 10 assessment & plan → plan accept v1 → kind flips to
TREATMENT → session report → PHQ-9 check-in (item 9 = 0 → no hold;
item 9 > 0 → hold) → crisis keyword mirror → `crisis_stop` +
SAFETY_HOLD → session start 403 → resume rules ("struggling" keeps
hold; same-day "safe" refused by the 12 h rule).
