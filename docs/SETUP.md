# Cureocity Mind — production setup

The scribe is a single Next.js app on Vercel against a Neon Postgres,
with a small set of third-party providers. This file lists every account
and env var per sprint, so procurement runs in parallel with build.

## Accounts at-a-glance

| Provider | Used for | First needed | Plan tier |
|---|---|---|---|
| **GitHub** | Repo + Actions CI | Sprint 0 | Free |
| **Vercel** | Web hosting + edge functions + Blob | Sprint 0 | **Pro** (60 s fn budget) |
| **Neon** | Postgres (existing) | Sprint 0 | Launch / Scale |
| **GCP** + Vertex AI | Gemini 1.5 Flash + Pro | Sprint 2 | Pay-as-you-go |
| **Firebase** (GCP) | Phone-OTP therapist auth | Sprint 1 (real auth: Sprint 12) | Spark / Blaze |
| **AWS** or **GCP** KMS | Tenant key wrap for field encryption | Sprint 11 | Per-call |
| **Stripe** | Billing (Canada / US) | Sprint 10 | Standard |
| **Razorpay** | Billing (India) | Sprint 10 | Standard |
| **Sentry** | Error tracking | Sprint 12 | Team |
| **SendGrid** | Transactional email | Sprint 9–10 | Essentials |
| Optional: **Twilio** | SMS reminders | Sprint 9+ | Pay-as-you-go |
| Optional: **WATI** | WhatsApp reminders (India) | Sprint 9+ | Standard |
| **Domain** | Production hostname + TLS | Sprint 12 | Registrar of choice |

## Environment variables

Variables marked `(public)` are exposed to the browser via the
`NEXT_PUBLIC_*` prefix; everything else is server-only. Vercel project
settings is the source of truth in production; `.env.local` mirrors them
in development.

### Sprint 0 — engine alive on mock
```
# Database (Neon, set by the Vercel-Neon integration)
DATABASE_URL=                  # pooled (PgBouncer) — runtime
DATABASE_URL_UNPOOLED=         # direct — migrations + seed
POSTGRES_PRISMA_URL=           # alias Vercel sets; prisma.ts reads either

# LLM backend
LLM_BACKEND=mock               # 'mock' (default) or 'vertex'

# Auth (absent → demo bypass auto-engages)
# FIREBASE_PROJECT_ID=
# FIREBASE_CLIENT_EMAIL=
# FIREBASE_PRIVATE_KEY=
# NEXT_PUBLIC_FIREBASE_API_KEY=                (public)
# NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=            (public)
# NEXT_PUBLIC_FIREBASE_PROJECT_ID=             (public)
# NEXT_PUBLIC_FIREBASE_APP_ID=                 (public)
```

### Sprint 1 — recording
```
# Vercel Blob (audio chunks)
BLOB_READ_WRITE_TOKEN=
```

### Sprint 2 — real Gemini
```
LLM_BACKEND=vertex
VERTEX_PROJECT_ID=
VERTEX_FLASH_REGION=asia-south1        # India clinics default
VERTEX_PRO_REGION=us-central1          # Pro is global
VERTEX_FLASH_MODEL=gemini-2.5-flash      # default; pin to gemini-1.5-flash for cheaper, lower-quality
VERTEX_PRO_MODEL=gemini-2.5-pro          # default; pin to gemini-1.5-pro for cheaper, lower-quality
GOOGLE_APPLICATION_CREDENTIALS=        # path to service-account JSON

# Cost guard (override defaults if needed)
COST_CAP_PER_SESSION_INR=500
COST_CAP_PER_THERAPIST_MONTHLY_INR=15000
```

### Sprint 9 — clinic regions + notifications
```
DEFAULT_CLINIC_REGION=ASIA_SOUTH       # ASIA_SOUTH | NORTH_AMERICA
SENDGRID_API_KEY=
EMAIL_FROM_ADDRESS=notifications@cureocitymind.com
# Optional channels
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
WATI_API_KEY=
WATI_API_ENDPOINT=
```

### Sprint 10 — billing
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=    (public)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=           (public)
BILLING_RETURN_URL=https://app.cureocitymind.com/app/settings/plan
```

### Sprint 11 — field encryption
```
KMS_PROVIDER=aws                       # aws | gcp | local-dev
AWS_KMS_KEY_ID=
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# OR
GCP_KMS_KEY_NAME=projects/.../locations/.../keyRings/.../cryptoKeys/...
```

### Sprint 12 — launch
```
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=                (public)
SENTRY_AUTH_TOKEN=
APP_BASE_URL=https://app.cureocitymind.com
NEXT_PUBLIC_APP_BASE_URL=https://app.cureocitymind.com   (public)
```

## Account-by-account procurement notes

### Vercel
1. Create project from this repo; pick `apps/web` as the root directory.
2. Bind the Neon integration (auto-populates the `DATABASE_URL*` set).
3. Switch the project to the **Pro** plan — the 60-second function
   budget is what makes Pass 1 + Pass 2 fit in one synchronous request.
4. Generate a Blob read-write token from the Vercel Blob dashboard
   (Sprint 1).

### GCP + Vertex AI
1. Create a new GCP project (`cureocity-mind-prod`).
2. Enable APIs: Vertex AI, Cloud Storage, Cloud Logging.
3. Create a service account with `roles/aiplatform.user`. Generate a
   JSON key. **Do not** commit it; paste the JSON into Vercel as the
   `GOOGLE_APPLICATION_CREDENTIALS_JSON` env (then write it to a tmp
   file on cold start, or use Workload Identity Federation in Sprint 12).
4. In Vertex AI, ensure `gemini-2.5-flash` is enabled in
   `asia-south1` (and `northamerica-northeast1` for Canada clinics),
   and `gemini-2.5-pro` in your global region (or `us-central1`).
   These are our defaults — 2.5 has materially better clinical-note
   quality than 1.5 for a small cost bump. Override per-deploy via
   `VERTEX_FLASH_MODEL` / `VERTEX_PRO_MODEL` if you ever need to
   downgrade for cost or upgrade to a future model line.

### Firebase
1. Create a Firebase project under the same GCP project.
2. Enable **Phone** sign-in. Add `+91 65656 65656` (or any test number)
   so QA can run without real SMS in non-prod.
3. Add the production hostname to Authorized Domains.
4. Copy the web SDK config into `NEXT_PUBLIC_FIREBASE_*`.
5. From the Firebase console > Service accounts, generate a private key
   for `firebase-admin` and paste it into `FIREBASE_PRIVATE_KEY`. The
   literal `\n` characters must be preserved.

### Neon
- Existing project. For Sprint 11, enable encryption-at-rest (default
  on paid tiers) and verify the region matches the clinic's residency.

### AWS / GCP KMS (Sprint 11)
- Create one Customer Master Key per region (`ap-south-1` and
  `ca-central-1`).
- Use `LocalDevKmsProvider` until then.

### Stripe + Razorpay
- One Stripe account, one Razorpay account.
- Create products: `Seed` (10 sessions/mo), `Roots` (50), `Canopy`
  (unlimited).
- Set up webhook endpoints at `/api/v1/billing/stripe/webhook` and
  `/api/v1/billing/razorpay/webhook` (Sprint 10).

### Sentry, SendGrid, domain
- Create the Sentry org, install the Vercel integration so the auth
  token + DSN sync automatically.
- SendGrid: verify the sender domain; create an API key with
  `Mail Send` scope only.
- Domain: point apex + `app.` to Vercel; let Vercel issue the TLS cert.

## Local development

```bash
pnpm install
cp .env.example .env.local           # fill in the values you have
pnpm exec prisma generate
pnpm exec prisma migrate deploy      # against your local or Neon dev branch
pnpm exec prisma db seed             # creates Dr. Priya + demo client
pnpm --filter @cureocity/web dev     # http://localhost:3000
```

`LLM_BACKEND=mock` (default) means the scribe runs end-to-end without
GCP — the engine returns a deterministic stub note.
