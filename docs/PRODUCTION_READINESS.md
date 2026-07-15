# Production readiness — the operational truth

**Last verified: 2026-07-15.** This is the single source of truth for
"what state is production actually in" — what's configured, what's
pending, and how to check. It complements `docs/ENVIRONMENT.md` (the full
env-var matrix) by recording the **live posture**, not just the schema.

The fastest way to read the live posture yourself:

```
GET https://mind.cureocity.in/api/v1/health?token=<HEALTH_CHECK_TOKEN>
```

Returns a `config` block of booleans (never secret values). Without the
token the config is hidden and you get just `{"status":"ok"}`.

## Verified live (as of 2026-07-15)

| Area                      | Signal                                                                     | State                                          |
| ------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| App + database            | `status:"ok"`, `databaseUrlSet:true`                                       | ✅                                             |
| Auth                      | `firebaseAdmin:true`, `firebaseClient:true`, `bypassActive:false`          | ✅ real per-user auth, no bypass               |
| PII encryption            | `kmsBackend:"gcp-kms"`                                                     | ✅ Google Cloud KMS, asia-south1               |
| LLM                       | `llmBackend:"vertex"`                                                      | ✅ real AI; mock throws at boot on deploy      |
| WebAuthn                  | `rpId:"cureocity.in"`, `originsPinned:true`                                | ✅ passkeys sound on both practitioner domains |
| Health-config gate        | `HEALTH_CHECK_TOKEN` set                                                   | ✅ config hidden from the public               |
| Crons                     | 5 registered in `vercel.json`, `CRON_SECRET` set                           | ✅ all fail-closed, verified 200               |
| Gateway                   | `gateway.cureo.city/healthz` → ok, `backend:"vertex"`, `SENTRY_DSN` set    | ✅ + error reporting live                      |
| Sentry (web)              | `SENTRY_DSN` set                                                           | ✅                                             |
| DR                        | Neon Launch (7-day PITR), first restore drill logged                       | ✅ `docs/runbooks/dr-log.md`                   |
| Preview↔prod DB isolation | Neon `preview` branch bound to Vercel Preview scope                        | ✅ previews no longer touch prod               |
| Domains                   | mind / scribe / care all verified live + canonical redirects on            | ✅ `docs/THREE_PRODUCTS.md`                    |
| Uptime                    | 2 UptimeRobot monitors (app health + gateway healthz), 5-min, email alerts | ✅                                             |
| Founder admin             | `role='ADMIN'` granted on prod (manual SQL, audited)                       | ✅                                             |

## Env vars set on production this cycle

Set on **Vercel (Production scope)** unless noted. Values are never in
this doc — only what the var does and its current state.

| Var                                                                          | Purpose                                                                        | State                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `CRON_SECRET`                                                                | fail-closed Bearer for all crons                                               | ✅ set                                                                                         |
| `SENTRY_DSN`                                                                 | web error reporting                                                            | ✅ set (also on the Cloud Run gateway)                                                         |
| `WEBAUTHN_RP_ID` = `cureocity.in`                                            | passkey relying-party (parent domain → works on all subdomains)                | ✅ set                                                                                         |
| `WEBAUTHN_ORIGINS` = `https://mind.cureocity.in,https://scribe.cureocity.in` | passkey origin allowlist                                                       | ✅ set                                                                                         |
| `WEBAUTHN_TICKET_SECRET`                                                     | HMAC for passkey registration tickets (was using a public dev fallback)        | ✅ set                                                                                         |
| `HEALTH_CHECK_TOKEN`                                                         | gates the `/health` config block                                               | ✅ set                                                                                         |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` / `SENDGRID_FROM_NAME`            | email channel — welcome, crisis alert, unsigned-note digest, billing reminders | ✅ set (Mail-Send-only key)                                                                    |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` (Preview scope)                     | preview builds hit the Neon `preview` branch, not prod                         | ✅ split via the Neon–Vercel integration ("Production environment only") + manual Preview vars |
| Neon–Vercel integration                                                      | scoped to **Production only** so Preview uses the manual branch vars           | ✅                                                                                             |

Gateway env (Cloud Run `live-gateway`): `LLM_BACKEND=vertex`,
`LIVE_GATEWAY_SECRET` (rotated), `SENTRY_DSN`, region asia-south1 —
all ✅.

## Pending — before charging money (NOT week-0 blockers)

| Item                                              | Trigger                                                         | Notes                                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Razorpay live keys + webhook**                  | before the first _paying_ therapist hits the session-11 paywall | `BILLING_BACKEND=razorpay` + `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET` + `NEXT_PUBLIC_RAZORPAY_KEY_ID` (redeploy) + register the webhook at `…/api/v1/billing/razorpay/webhook`. Code is complete; this is console work. |
| `INVOICE_SELLER_*`                                | before a legally-valid GST invoice                              | seller legal name / GSTIN / address                                                                                                                                                                                        |
| `BOOTSTRAP_ADMIN_EMAILS` = `shamil.gtz@gmail.com` | future cofounder auto-promotion                                 | one-time; no redeploy needed                                                                                                                                                                                               |
| Delete 6 demo fixture rows                        | before any public directory surface                             | seeded `@cureocity.mind` therapists (Priya/Rohan/…), inert but should go                                                                                                                                                   |

## Pending — Care launch (keep sign-ups gated)

- **Live-token architecture decision** — launch Care on ai-studio
  ephemeral tokens, not `vertex` (the SA-token exposure). See
  `docs/runbooks/care.md`.
- **Consumer legal surface** — Care-specific privacy notice + terms
  (Cureocity is the direct fiduciary). Lawyer work.
- **`CARE_CRISIS_ALERT_EMAIL`** — set so crisis escalations page a human
  by email (Sentry already fires today regardless).
- **`CARE_LIVE_BACKEND`** — must be `ai-studio` (with `GEMINI_API_KEY`)
  before enabling; unset/`mock` now safely 503s on deploy (PROD2).
- Flip **`CARE_SIGNUPS_OPEN=true`** only after the above.

## Pending — WhatsApp (nice-to-have, not safety)

`WATI_API_BASE` + `WATI_BEARER_TOKEN` + template IDs — WhatsApp patient
shares + reminders. The portal-link and email channels work without it.

## Optional hardening (someday)

- **`REQUIRE_WEBAUTHN_SIGNING=true`** — flip after pilot therapists have
  enrolled passkeys (forces enrollment before signing).
- **`PILOT_INVITE_REQUIRED=true`** + minted codes — gate open signup.
- OTLP endpoint / `OBSERVABILITY_WEBHOOK_URL` — forward metrics + a
  crisis-escalation webhook.
- Pin the Vercel function region (PHI compute defaults to US iad1; the
  Neon DB is also us-east — a deliberate DPDP-residency decision for
  post-pilot).
- Sentry cron monitors; provider spend alerts (GCP/Vercel/Neon).

## The health endpoint (reference)

`GET /api/v1/health` — base `status`/200/503 is public (the Vercel probe).
The `config` block is gated by `HEALTH_CHECK_TOKEN` in production; pass it
as `?token=` or the `x-health-token` header. Config fields:

```
databaseUrlSet, auth{firebaseAdmin, firebaseClient, bypassActive},
kmsBackend, llmBackend, channels{sendgrid, wati},
webauthn{rpId, originsPinned}, pilotInviteRequired,
observabilityForwarding, vercelEnv
```

Auth-posture twin: `GET /api/v1/health/auth` (behind the practitioner
guard) explains _why_ bypass is on/off. Gateway: `GET /live/health`
proxies the Cloud Run `/healthz`.

## See also

- `docs/ENVIRONMENT.md` — the full env-var matrix by subsystem
- `docs/THREE_PRODUCTS.md` — the domain split
- `docs/PILOT_PLAYBOOK.md` + `docs/pilot/` — running the pilot
- `docs/CHANGELOG.md` — dated record of changes
- `docs/runbooks/` — operational runbooks (DR, gateway deploy, care, …)
