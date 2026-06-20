# Deploying Cureocity Mind to Vercel

This is the **Vercel-only** deployment path. One Vercel project, one
Neon Postgres database, one Vercel Blob store, one Firebase project per
audience. No Railway, no Render, no separate container hosts.

The entire stack — backend API routes and both PWA frontends — lives
in a single Next.js app at `apps/web`. UI routes serve under `/`,
`/t/*` (therapist), `/c/*` (client); BFF routes serve under `/api/v1/*`
from the same domain. The six NestJS services under `services/` are
NOT deployed — they remain in the repo for local dev with
`pnpm infra:up`.

## Architecture in one paragraph

```
                       [apps/web (Vercel)]
                         /               → role selector
[browser/PWA] ─────────> /t/*            → therapist UI         ──┐
                         /c/*            → client PWA            ─┤
                         /api/v1/*       → backend functions    ──┴──> [Neon Postgres]
                                                                 ├──> [Vercel Blob]
                                                                 ├──> [Vertex AI]
                                                                 └──> [Firebase Admin]
```

## Prerequisites

| Service              | What you need                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub               | The repo. You own write access (the branch lives at `claude/determined-goodall-WTmGl`).                                                                        |
| Vercel               | Hobby is enough for first deploy; **Pro for any real use** (60s function timeout vs Hobby's 10s — Pass 2 Gemini needs the headroom).                           |
| Neon Postgres        | Free tier. Pick the closest region (Mumbai or Singapore for India residency).                                                                                  |
| Firebase             | Two projects — one for therapists, one for patients. Each with Phone Auth enabled. Free tier covers low-volume pilot.                                          |
| Vertex AI (optional) | A GCP project with Vertex AI enabled + a service-account key. Without this, the backend uses `MockGeminiBackend` and notes are deterministic placeholder text. |

## Step 1 — Provision Neon

1. neon.tech → create a project → choose the region.
2. Copy the **pooled connection string** (it ends in `-pooler.<region>.aws.neon.tech/...?sslmode=require`).
3. Open the SQL editor and run nothing — Prisma will do the schema in step 4.

## Step 2 — Create one Vercel project from the GitHub repo

In the Vercel dashboard, click **Add New → Project** once.

**`cureocity-mind-web`**

| Setting                  | Value                                                  |
| ------------------------ | ------------------------------------------------------ |
| Framework Preset         | Next.js                                                |
| Root Directory           | `apps/web`                                             |
| Node.js Version          | 22.x                                                   |
| Build / Install / Output | leave defaults — `apps/web/vercel.json` overrides them |

This single project hosts everything: role-selector at `/`, therapist
UI at `/t/*`, client PWA at `/c/*`, and the BFF at `/api/v1/*` — all
served from one domain so there's no CORS to configure.

`apps/web/vercel.json` declares the build command — it runs
`pnpm exec prisma migrate deploy` against `DATABASE_URL_UNPOOLED`
before `next build`, so schema changes auto-apply on every deploy.
Vercel auto-detects pnpm from the lockfile.

## Step 3 — Configure environment variables

All vars live on the one `cureocity-mind-web` project. Server-side
vars (no `NEXT_PUBLIC_` prefix) are only available to `/api/v1/*`
route handlers; `NEXT_PUBLIC_*` vars are inlined into the client
bundle at build time.

The two `FIREBASE_*` web-config sets are kept separate so a therapist
and a client can never share a Firebase UID — the boundary is enforced
at the SDK level by which init module gets imported from which route
subtree (`lib/firebase-therapist.ts` under `/t/*`, `lib/firebase-client.ts`
under `/c/*`).

### Backend (server-only)

| Var                                  | Value                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                       | Neon pooled connection string (auto-injected if you use the Vercel-Neon integration)         |
| `DATABASE_URL_UNPOOLED`              | Neon direct (non-pooled) connection — used by build-time `prisma migrate deploy`             |
| `AUTH_BYPASS`                        | `false` in Production, `true` in Preview if you want a working preview without real Firebase |
| `FIREBASE_PROJECT_ID`                | from the therapist Firebase project                                                          |
| `FIREBASE_CLIENT_EMAIL`              | service-account email                                                                        |
| `FIREBASE_PRIVATE_KEY`               | service-account private key (paste with literal `\n` for newlines)                           |
| `LLM_BACKEND`                        | `mock` (default) or `vertex`                                                                 |
| `VERTEX_PROJECT_ID`                  | GCP project id (when LLM_BACKEND=vertex)                                                     |
| `VERTEX_FLASH_REGION`                | `asia-south1`                                                                                |
| `VERTEX_PRO_REGION`                  | `global`                                                                                     |
| `KMS_BACKEND`                        | `local-dev` (until AWS KMS is wired in PR 8+)                                                |
| `CRYPTO_DEV_MASTER_SECRET`           | any random 32+ char string                                                                   |
| `COST_CAP_PER_SESSION_INR`           | `500`                                                                                        |
| `COST_CAP_PER_THERAPIST_MONTHLY_INR` | `15000`                                                                                      |

### Frontend (`NEXT_PUBLIC_*`, inlined into client bundle)

| Var                                       | Value                                           |
| ----------------------------------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_API_BASE`                    | `/api/v1` (same-origin — no scheme/host needed) |
| `NEXT_PUBLIC_FIREBASE_API_KEY`            | therapist Firebase web-app config               |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`        | therapist Firebase web-app config               |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`         | therapist Firebase web-app config               |
| `NEXT_PUBLIC_FIREBASE_APP_ID`             | therapist Firebase web-app config               |
| `NEXT_PUBLIC_FIREBASE_CLIENT_API_KEY`     | patient Firebase web-app config                 |
| `NEXT_PUBLIC_FIREBASE_CLIENT_AUTH_DOMAIN` | patient Firebase web-app config                 |
| `NEXT_PUBLIC_FIREBASE_CLIENT_PROJECT_ID`  | patient Firebase web-app config                 |
| `NEXT_PUBLIC_FIREBASE_CLIENT_APP_ID`      | patient Firebase web-app config                 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`            | from `npx web-push generate-vapid-keys`         |

## Step 4 — Prisma migrations

No manual step needed for production: `apps/web/vercel.json`'s
`buildCommand` runs `DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm exec
prisma migrate deploy` before `next build` on every deploy.
Idempotent — already-applied migrations are no-ops.

For local dev:

```bash
export DATABASE_URL="postgresql://...@neon...sslmode=require"
pnpm exec prisma migrate deploy
```

## Step 5 — Create the Vercel Blob store

In the `cureocity-mind-web` Vercel project: **Storage → Create
Database → Blob**. Vercel auto-injects `BLOB_READ_WRITE_TOKEN` into
the project env. No code changes needed; `@vercel/blob`'s `put()`
reads the token implicitly.

## Step 6 — Deploy

Push your branch. The Vercel project auto-deploys. First build takes
3-5 min (pnpm workspace install + Prisma client + dependent package
builds + migrate deploy + next build).

You'll get one URL:

- `https://cureocity-mind-web.vercel.app`
  - `/` — role selector ("I'm a therapist" / "I have a link from my therapist")
  - `/t/*` — therapist UI
  - `/c/*` — client PWA (installable)
  - `/api/v1/*` — backend (same-origin from the frontends)

## Step 7 — Smoke test

```bash
# Should return {"status":"ok","service":"cureocity-api"}
curl https://cureocity-mind-web.vercel.app/api/v1/health
```

Open `/` in a browser, pick "I'm a therapist", complete phone-OTP
signup (real OTP via Firebase), and you'll land on the clients tree.
Then create a client, generate a claim link, open it on a phone (or
incognito) to walk through the patient pairing → home → exercise flow.

## What's working at Vercel right now (PRs 1–6)

| Surface                            | Status | Notes                                                                       |
| ---------------------------------- | ------ | --------------------------------------------------------------------------- |
| Health                             | ✅     | `/api/v1/health` ports the NestJS pattern; verifies Neon reachable.         |
| Psychologists                      | ✅     | POST /api/v1/psychologists (idempotent)                                     |
| Clients                            | ✅     | List / create / get / patch / briefing                                      |
| Claim tokens (QR pairing)          | ✅     | Issue / preview / redeem                                                    |
| Admin                              | ✅     | Audit-log read + audit-of-the-audit + grant/revoke                          |
| DSR (DPDP §§ 11–15)                | ✅     | All 6 endpoints                                                             |
| Sessions                           | ✅     | Create / start / end / consent / get                                        |
| Audio chunks                       | ✅     | Stored in Vercel Blob (URL in `s3Key`)                                      |
| Note generation                    | ✅     | Synchronous Pass 1 + Pass 2 on `/sessions/:id/generate-note` (cost-guarded) |
| WebAuthn sign-off                  | ✅     | Full chain (hash + assertion + edits validation)                            |
| Therapy notes + revision history   | ✅     | GET `/sessions/:id/therapy-note`                                            |
| Exercise prescription + completion | ✅     | Both therapist + patient paths                                              |
| Mood logs, journal, next session   | ✅     | All under `/me/*`                                                           |
| Push subscriptions                 | ✅     | Register + soft-revoke                                                      |

## What's NOT yet ported

| Surface                                                | Where it lives                                                                                          | When to port                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modality-workflow service                              | `services/modality-workflow-service`                                                                    | When the therapist UI surfaces CBT/EMDR phase transitions.                                                                                                    |
| Affect-engine service                                  | `services/affect-engine-service`                                                                        | When the briefing dossier renders affect trends.                                                                                                              |
| PDF generation (treatment plan PDFs)                   | `services/pdf-generator-service`                                                                        | Needs `@sparticuz/chromium` for Vercel (full Puppeteer Chromium exceeds Function limits).                                                                     |
| Notifications fan-out (push send / WATI / SMS / email) | `packages/notifications` backends. Subscriptions persist; outbound dispatch isn't wired in the BFF yet. | When you want reminders to actually send.                                                                                                                     |
| Field-level encryption on journal entries              | `services/continuity-service/src/encryption`                                                            | The BFF journal POST currently writes plaintext only (matches the pre-Sprint-9-PR-3 NestJS path). Port `@cureocity/crypto` into `apps/web/lib/encryption.ts`. |

None of these block the core demo loop (signup → session → note →
exercise → adherence). They're the next sprint's work.

## Troubleshooting

| Symptom                                    | Cause                                  | Fix                                                                                                 |
| ------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Build fails at `prisma generate`           | `DATABASE_URL` set to non-Neon URL     | Use pooled Neon string with `?sslmode=require`                                                      |
| `404` on `/api/v1/<anything>`              | Project root-directory wrong           | Should be `apps/web`, not `apps/web/app`                                                            |
| `500` with "Firebase Admin not configured" | Env vars not set on the API project    | Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (with literal `\n` newlines) |
| Function times out at 10s                  | Hobby plan                             | Upgrade to Pro (60s) for the `/generate-note` path                                                  |
| Audio chunk uploads 413                    | `> 2 MB` body                          | Patient PWA's chunker should produce 1-s frames (~32 KB). Misconfigured `chunkDurationMs`?          |
| `CRYPTO_DEV_MASTER_SECRET` not set warning | LocalDevKmsProvider boot in production | Set the env var to any random string ≥ 32 chars; rotate quarterly until AWS KMS is wired            |

## Costs at idle pilot volume

| Service       | Free tier covers                          | Likely $/month with pilot use                                       |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Vercel        | 100 GB-h of function exec, 1 TB bandwidth | Free for <100 sessions/month                                        |
| Neon          | 0.5 GB storage, 191 compute-hours         | Free for pilot                                                      |
| Vercel Blob   | 1 GB storage, 100 GB bandwidth            | Free for <100 sessions/month                                        |
| Firebase Auth | 10 K phone OTPs/month                     | Free for pilot                                                      |
| Vertex AI     | n/a                                       | ~₹5/session (Pass 1 + Pass 2 combined); ₹500/month for 100 sessions |

Total at 100-session/month pilot: ~₹500 ($6). The cost-guard's
`COST_CAP_PER_SESSION_INR=500` defaults keep any single runaway
session bounded.
