# Environment & configuration

The authoritative, current-state map of environment variables and where they
live across the deploy topology. The canonical template with inline comments
is **[`.env.example`](../.env.example)** (copy to `.env.local` for dev); this
file groups it by subsystem and adds the **prod deploy** picture.
`docs/SETUP.md` has the per-sprint procurement history.

> **Config lives in two places:** the Vercel project (for `apps/web`) and the
> Cloud Run service (for `services/live-gateway`). A var is only read where
> its subsystem runs — see §7.

## 1. Minimal local dev (mock, no cloud creds)

```
DATABASE_URL=postgresql://…            # Neon dev branch or local Postgres
LLM_BACKEND=mock                       # deterministic AI end-to-end (default)
# leave FIREBASE_* unset               → AUTH_BYPASS auto-engages (dev fixture)
# leave KMS_BACKEND=local-dev + CRYPTO_DEV_MASTER_SECRET set (defaults)
```

`pnpm --filter @cureocity/web dev`. For the doctor live flow, also run the
gateway: `pnpm gateway` (defaults to `ws://localhost:8787`, `LLM_BACKEND=mock`).

## 2. Core (required in prod)

| Var                                                                     | Purpose                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED`, or the `POSTGRES_*` aliases) | Neon Postgres. `apps/web/lib/prisma.ts` reads whichever is set first.                     |
| `LLM_BACKEND`                                                           | `mock` (default) or `vertex`. `NEXT_PUBLIC_LLM_BACKEND` mirrors it to the browser banner. |
| `BLOB_READ_WRITE_TOKEN`                                                 | Vercel Blob — audio-chunk + PDF persistence.                                              |
| `NODE_ENV` / `VERCEL_ENV`                                               | Runtime mode; `VERCEL_ENV=production` toggles fail-closed behaviors.                      |

## 3. Vertex AI / Gemini (required when `LLM_BACKEND=vertex`)

| Var                                                                                                         | Purpose                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERTEX_PROJECT_ID`                                                                                         | GCP project for Vertex.                                                                                                                                 |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`                                                                       | Full service-account JSON (materialised to `/tmp` on cold start). Also reused by GCP KMS. `GOOGLE_APPLICATION_CREDENTIALS` (path) is the local-dev alt. |
| `VERTEX_FLASH_REGION` (`asia-south1`) / `VERTEX_PRO_REGION` (`global`)                                      | Pass 1 stays in India (DPDP); transcript-only passes go global.                                                                                         |
| `VERTEX_FLASH_MODEL` / `VERTEX_PRO_MODEL`                                                                   | Defaults `gemini-2.5-flash` / `gemini-2.5-pro`.                                                                                                         |
| `VERTEX_CLINICAL_MODEL` / `VERTEX_THERAPY_SCRIPT_MODEL` / `VERTEX_BRIEF_MODEL` / `VERTEX_REASONING_MODEL` … | Per-pass overrides; each falls through to the Pro model.                                                                                                |
| `LLM_THINKING_BUDGET_PASS{2..8}` / `LLM_THINKING_BUDGET_DIFFERENTIAL`                                       | Per-pass "thinking" token budgets.                                                                                                                      |
| `COST_CAP_PER_SESSION_INR` / `COST_CAP_PER_THERAPIST_MONTHLY_INR`                                           | Cost circuit breaker.                                                                                                                                   |

## 4. Auth, identity & signing

| Var                                                                      | Purpose                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Server-side Firebase Admin. **If any is missing → `AUTH_BYPASS` auto-engages** (fails closed on Vercel prod). |
| `NEXT_PUBLIC_FIREBASE_*` (public)                                        | Browser Firebase SDK config.                                                                                  |
| `AUTH_BYPASS`                                                            | Explicit override. `true` = every sign-in resolves to the demo therapist.                                     |
| `BOOTSTRAP_ADMIN_EMAILS`                                                 | Comma-separated emails auto-granted ADMIN on first sign-in.                                                   |
| `WEBAUTHN_TICKET_SECRET`                                                 | HMAC key for the registration ticket (≥32 chars).                                                             |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGINS`               | Passkey relying-party + origin allowlist for note-sign assertions.                                            |
| `REQUIRE_WEBAUTHN_SIGNING`                                               | When `true`, an account with no passkey is refused (403) until it enrols.                                     |
| `PILOT_INVITE_REQUIRED`                                                  | Gate new signups behind an admin-minted invite code.                                                          |

## 5. Crypto / KMS (PII envelope encryption)

| Var                                   | Purpose                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `KMS_BACKEND`                         | Selects the KMS port: `local-dev` (scrypt from `CRYPTO_DEV_MASTER_SECRET`, dev/CI) or **`gcp-kms`** (production, GCP Cloud KMS over REST). |
| `CRYPTO_DEV_MASTER_SECRET`            | Dev master key (never in prod).                                                                                                            |
| `GCP_KMS_KEY_NAME`                    | The Cloud KMS crypto-key resource name (`projects/…/locations/asia-south1/keyRings/…/cryptoKeys/…`).                                       |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Reused from Vertex — the SA that KMS encrypt/decrypt runs as.                                                                              |

> **Note:** `.env.example`'s KMS comment still mentions an `aws-kms` option —
> that's stale. Production uses **`gcp-kms`** (wired this cycle, S32 Phase 2);
> `AwsKmsProvider` exists in `packages/crypto` for portability but is not
> wired in `apps/web`. See CLAUDE.md §11.

## 6. Live gateway (`services/live-gateway` — set on Cloud Run, not Vercel)

| Var                                                                                                                | Purpose                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_GATEWAY_SECRET`                                                                                              | HMAC key verifying the browser's start-token. **Gateway fails closed in prod without it.** Must match what `apps/web/lib/live-token.ts` signs with. |
| `LIVE_GATEWAY_PORT`                                                                                                | Listen port (default 8787).                                                                                                                         |
| `LIVE_GATEWAY_MAX_CONNECTIONS` / `LIVE_GATEWAY_MAX_SESSIONS`                                                       | Connection cap (200) + concurrent-consult pool (50, graceful "busy" shed).                                                                          |
| `LIVE_GATEWAY_STARTUP_GRACE_MS` / `LIVE_GATEWAY_IDLE_TIMEOUT_MS`                                                   | Per-connection timers.                                                                                                                              |
| `LIVE_MIN_WINDOW_MS` / `LIVE_MAX_WINDOW_MS` / `LIVE_SILENCE_MS`                                                    | VAD window sizing (6–12s, ≥600ms silence cut).                                                                                                      |
| `LIVE_NOTE_REFRESH_MS` / `LIVE_INTERIM_NOTE_MODEL` / `LIVE_REASONING_THINKING_BUDGET` / `LIVE_SKIP_SILENT_WINDOWS` | Note-refresh debounce + reasoning tuning.                                                                                                           |
| `LIVE_MAX_CONSULT_MS` / `LIVE_COST_CEILING_INR`                                                                    | Runaway-consult guards (default 90 min / ₹15).                                                                                                      |
| `LLM_BACKEND`, `VERTEX_*`                                                                                          | Same as §3 — the gateway runs Pass 1/2 + reasoning itself.                                                                                          |
| `NEXT_PUBLIC_LIVE_GATEWAY_URL` (public, **on Vercel**)                                                             | The `wss://…` URL the browser dials. Defaults to `ws://localhost:8787`.                                                                             |

## 7. External services

- **Billing (Razorpay):** `BILLING_BACKEND` (`mock` refuses to boot in prod
  unless `BILLING_ALLOW_MOCK=true`), `BILLING_ENFORCEMENT`, `RAZORPAY_KEY_ID`
  / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `BILLING_PRICE_*_INR` overrides,
  `INVOICE_SELLER_*` (GST invoice).
- **Patient messaging:** WhatsApp via WATI (`WATI_API_BASE`,
  `WATI_BEARER_TOKEN`, `WATI_TEMPLATE_*`), email via SendGrid
  (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`). Unset →
  Noop backend (dev still produces coherent `PatientShare` rows).
- **Observability:** `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_DISABLED` /
  `OBSERVABILITY_WEBHOOK_URL` (+ token), `SENTRY_DSN`.
- **Cron/retention:** `CRON_SECRET` (Bearer for `/api/v1/cron/*`),
  `AUDIO_RETENTION_DAYS`.
- **Affect engine:** `AFFECT_BASELINE_MIN_SESSIONS` /
  `AFFECT_BASELINE_WINDOW_SESSIONS` / `AFFECT_DEVIATION_SIGMA`.
- **Local infra only** (docker-compose; NOT the live request path):
  `REDIS_URL`, `KAFKA_*`, `S3_*`, `MinIO`.

## 8. Deploy topology — which var lives where

| Runs on                                                | Reads                                                                                                                         | Notably                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Vercel** (`apps/web`)                                | Core, Vertex creds, Firebase, KMS, billing, messaging, WebAuthn, cron, `NEXT_PUBLIC_*` (incl. `NEXT_PUBLIC_LIVE_GATEWAY_URL`) | The build runs `prisma migrate deploy` before the app build (`scripts/vercel-db-setup.sh`). |
| **Cloud Run** (`services/live-gateway`, `asia-south1`) | `LIVE_GATEWAY_*`, `LIVE_*`, `LLM_BACKEND`, `VERTEX_*`, GCP creds                                                              | Deploy is the `Dockerfile` + env; **no committed Cloud Run manifest**.                      |
| **Neon**                                               | —                                                                                                                             | `DATABASE_URL` points here; pooled + unpooled.                                              |
| **GCP**                                                | —                                                                                                                             | Cloud KMS (`asia-south1`) + Vertex Gemini, both via the one SA JSON.                        |

## 9. Gotchas

- Missing Firebase env silently flips the app into **auth bypass** — a
  security footgun in prod; `GET /api/v1/health/auth` reports the live posture.
- The gateway and the app must share the **same** `LIVE_GATEWAY_SECRET`, or
  every live consult 401s at connect.
- `.env.example` is a snapshot — trust the code + this file for KMS (`gcp-kms`)
  and any post-Sprint-72 vars.
- Public (`NEXT_PUBLIC_*`) vars are baked into the client bundle at build
  time — changing one requires a redeploy, not just an env edit.
