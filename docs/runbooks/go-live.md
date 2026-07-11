# Go-live runbook — Sprint 56 features

The fastest path from the current codebase to **real money + real
patients**. Every step is sequenced by dependency: don't skip ahead.
Estimated total time: **3–5 hours of clicking + 1–3 days waiting on
WhatsApp template approval**.

If you've already done a step (e.g. Vercel + Neon are set up from an
earlier sprint), check it off and move on. The Sprint 56-specific
sections are flagged **`[S56]`**.

---

## 0 · Pre-flight

You'll need these accounts (most are free to create):

- [ ] Vercel — **Pro plan** (the Hobby 60s cap kills Pass 3 + crons)
- [ ] GitHub (this repo already exists)
- [ ] Neon (Postgres)
- [ ] GCP project + Vertex AI billing on (Gemini)
- [ ] Firebase project (auth)
- [ ] Razorpay (India billing) — **Activated** (KYC done; not just signed up)
- [ ] SendGrid (transactional email) — **Sender authenticated**
- [ ] WATI (WhatsApp Business via partner) — **WhatsApp Business
      number approved**
- [ ] Domain registered (e.g. `cureocitymind.com`)

If any of these aren't ready, do **§1, §2, §6, §7** first (the
ones you can do without those accounts).

---

## 1 · Vercel project + domain

1. Import the GitHub repo into Vercel as a **Next.js** project. Set
   the project root to `apps/web` if Vercel asks.
2. Upgrade the project's team/plan to **Pro**. Without this the cron
   functions can be killed mid-flight and `vercel.json` crons may not
   run on the every-day schedule.
3. Add your domain. The marketing landing page is at the apex
   (`cureocitymind.com`) and the app at `app.cureocitymind.com`.
4. **DO NOT deploy yet** — there's no DB or auth wired up, so the
   build will fail on `prisma generate` if the env vars aren't
   present.

---

## 2 · Neon Postgres

1. Create a **Production** project in Neon (asia-south1 if available
   for DPDP residency).
2. Copy the **pooled** connection string (it ends `-pooler...`). Set
   on Vercel:
   ```
   DATABASE_URL=postgresql://...neon.tech/...?sslmode=require&pgbouncer=true
   ```
3. **Run migrations from your laptop** (the build step's
   `vercel-db-setup.sh` does this too, but doing it manually first
   catches issues you can act on):
   ```bash
   DATABASE_URL=… pnpm exec prisma migrate deploy
   ```
   You should see every Sprint 13→56 migration apply. The last 5 are
   Sprint 56 lifecycle/referral/UTM/invoice — confirm all 5 land
   green.

---

## 3 · Firebase auth cutover

The auth bypass auto-engages when these envs are missing — once you
set them, real Firebase auth takes over and bypass is off.

1. Firebase Console → Project Settings → Service Accounts →
   **Generate new private key**. You get a JSON file.
2. From that JSON pull three values and set on Vercel:
   ```
   FIREBASE_PROJECT_ID=<project_id>
   FIREBASE_CLIENT_EMAIL=<client_email>
   FIREBASE_PRIVATE_KEY=<private_key, including the BEGIN/END lines>
   ```
   The private key has literal `\n` in it — paste as-is, Vercel
   handles the escaping.
3. Authentication → Sign-in method → enable **Phone** (the
   primary auth flow for Indian therapists).
4. After first deploy, `currentPsychologist()` will verify the
   `__session` cookie / Bearer token. If you see "auth bypass active"
   in the logs after deploy, one of the three envs is wrong.

---

## 4 · GCP + Vertex AI (Gemini)

1. GCP Console → enable **Vertex AI API** on your project.
2. Create a service account with **Vertex AI User** role; download
   its key as JSON.
3. Set on Vercel (these are the exact keys `apps/web/lib/llm.ts:58–74`
   reads):
   ```
   GOOGLE_APPLICATION_CREDENTIALS_JSON=<the whole SA-key JSON, one line>
   LLM_BACKEND=vertex                    # switches off mock
   VERTEX_PROJECT_ID=<your GCP project id>
   VERTEX_FLASH_REGION=asia-south1       # Pass 1 — DPDP residency
   VERTEX_PRO_REGION=global              # Passes 2–8
   # Optional model overrides (defaults shown):
   # VERTEX_FLASH_MODEL=gemini-2.5-flash
   # VERTEX_PRO_MODEL=gemini-2.5-pro
   ```
   After deploy, hit `GET /api/v1/health/llm` — it reports which envs
   are present and which Vertex setup it picked.
4. **Cost guards** stay on by default. To tune for pilot scale:
   ```
   COST_CAP_PER_SESSION_INR=500          # Pass-3 etc circuit breaker
   COST_CAP_PER_THERAPIST_MONTHLY_INR=15000
   ```

---

## 5 · Razorpay (real money) **[S56]**

> ⚠️ **Critical:** without this, every checkout mints a mock order
> that "succeeds" but never charges. Doing this wrong means happy
> users who didn't actually pay.

1. Razorpay Dashboard → Settings → API Keys → **Generate Live Keys**.
   You only see the secret once — copy both.
2. Settings → Webhooks → **Add new webhook**:
   - URL: `https://app.cureocitymind.com/api/v1/billing/razorpay/webhook`
   - Active events: `payment.captured`, `payment.failed`, `order.paid`
   - Set a webhook secret (Razorpay generates one; copy it).
3. Set on Vercel:
   ```
   BILLING_BACKEND=razorpay
   RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXX
   RAZORPAY_KEY_SECRET=<secret>
   RAZORPAY_WEBHOOK_SECRET=<secret>
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXX   # same key_id, exposed to browser
   ```
4. (Optional, only if A/B-testing prices) override any tier price
   without a deploy:
   ```
   BILLING_PRICE_PRO_MONTHLY_INR=2999          # for the 2,999 vs 3,499 test
   ```

---

## 6 · SendGrid (email) **[S56 — renewal reminders, dunning, shares]**

1. SendGrid → Sender Authentication → **Authenticate Your Domain**
   for `cureocitymind.com`. Add the DNS records SendGrid gives you;
   wait for green check.
2. Verify a Single Sender for `reminders@cureocitymind.com` (or
   whatever you want shown in the From field).
3. Settings → API Keys → Create key with **Restricted Access** /
   Mail Send only. Copy.
4. Set on Vercel:
   ```
   SENDGRID_API_KEY=SG.XXXXXXXX
   SENDGRID_FROM_EMAIL=reminders@cureocitymind.com
   SENDGRID_FROM_NAME=Cureocity Mind
   ```
5. Test: after first deploy, the daily 03:30 UTC cron runs. Watch
   logs the next morning for `[billing-reminders] backend=wati+sendgrid`
   instead of `noop`.

---

## 7 · WATI (WhatsApp) **[S56 — biggest lead time]**

> ⏱ **Templates take 24–72 hours for WhatsApp Business to approve.**
> Do this on day 1 even if you skip the rest.

1. WATI → Sign up → connect a WhatsApp Business number (their
   onboarding walks you through this; ~30 min if your number is
   ready).
2. Templates → Submit two templates. Verbatim:
   - **Name:** `cureocity_renewal_reminder`
     **Category:** Utility
     **Body:**
     ```
     Hi from Cureocity Mind, your {{1}} plan renews in {{2}} day(s)
     on {{3}}. Open Settings → Plan in the app to switch tiers
     or update payment.
     ```
   - **Name:** `cureocity_plan_lapsed`
     **Category:** Utility
     **Body:**
     ```
     Hi from Cureocity Mind, your {{1}} plan lapsed on {{3}}. New
     session recording is paused. Open Settings → Plan to restore
     in one click ({{2}}-day reminder).
     ```
3. While waiting for approval, set on Vercel:
   ```
   WATI_API_BASE=https://live-mt-server.wati.io/<your-tenant>/api/v1
   WATI_BEARER_TOKEN=<token from WATI Dashboard → API Docs>
   WATI_TEMPLATE_RENEWAL_REMINDER=cureocity_renewal_reminder
   WATI_TEMPLATE_DUNNING=cureocity_plan_lapsed
   WATI_TEMPLATE_PATIENT_SHARE=patient_share   # the Sprint 15 template, if approved
   ```
4. Until templates are green, WATI calls error and the cron logs
   skip them — email still goes out. This is deliberate fail-safe
   behavior.

---

## 8 · Cron secret **[S56]**

Vercel sets `x-vercel-cron` automatically when the schedule fires —
no secret needed for that path. But you'll want a secret for manual
runs (e.g. testing reminders/dunning from your laptop):

```bash
# Generate
openssl rand -base64 32
```

Set on Vercel: `CRON_SECRET=<the value>`

Then you can poke either cron yourself:

```bash
curl -H "authorization: Bearer $CRON_SECRET" \
  https://app.cureocitymind.com/api/v1/cron/billing-reminders
```

---

## 9 · Marketing URL + watermark **[S56]**

This is the URL the patient-portal footer and share-email signature
link to:

```
NEXT_PUBLIC_MARKETING_URL=https://cureocitymind.com
```

When a patient clicks "Powered by Cureocity Mind" they land here with
`?utm_source=patient_portal&utm_medium=patient_share&utm_campaign=<artefact_type>`.

**Make sure your landing page's signup form forwards those URL params
into the signup body** as `acquisitionUtm: { utm_source, utm_medium,
utm_campaign }`. Without that step, the funnel dashboard's "Top
acquisition sources" card will show every signup as `(direct /
unknown)`.

---

## 10 · GST invoice seller details **[S56]**

The downloadable tax invoice (Settings → Plan → "Download invoice")
uses these to fill the Seller block. **Required** for the invoice to
be a legal GST tax invoice:

```
INVOICE_SELLER_LEGAL_NAME=Cureocity Mind Private Limited
INVOICE_SELLER_GSTIN=29ABCDE1234F1Z5         # your GSTIN; first 2 digits encode the state
INVOICE_SELLER_ADDRESS=<full registered office address, multi-line OK>
INVOICE_SELLER_STATE=Karnataka               # state from GSTIN (free text shown on invoice)
INVOICE_SELLER_EMAIL=billing@cureocitymind.com
```

These are the exact keys `apps/web/lib/invoice.ts:37–41` reads. Without
them the invoice still renders but with placeholder values (e.g.
`GSTIN: null`, address `—`), which a tax authority will not accept.
Get them in before any therapist downloads.

---

## 11 · Pilot gating (recommended for the first month)

```
PILOT_INVITE_REQUIRED=true          # signup requires an invite code
```

Generate codes from `POST /api/v1/admin/invite-codes` (admin auth).
Hand them out to your first 100 cold-DM responders. This keeps the
fire hose off until you know the product holds up under real load.

---

## 12 · Deploy + smoke check

1. Push to `main`. Vercel builds, runs `prisma migrate deploy` via
   `vercel-db-setup.sh`, and goes live.
2. **Smoke checks** (run these in order, fix anything red before
   continuing):
   - [ ] `curl https://app.cureocitymind.com/api/v1/health` → `200`
   - [ ] Sign up a test therapist via phone OTP. Confirm they land
         on `/app` (not `/login`).
   - [ ] Open Vercel logs; confirm **no "auth bypass active" lines**
         on a real request. If you see them, Firebase env is wrong.
   - [ ] Settings → Plan → click "Pro · monthly". Razorpay Checkout
         opens with **real ₹3,499** (not ₹999, not mock).
   - [ ] Pay in test mode → webhook flips the account to PAID →
         Plan page header reads "Pro · monthly".
   - [ ] Download a tax invoice for that payment. Confirm GSTIN
         is yours (not `__PENDING__`).
   - [ ] Open `/app/admin/funnel` as an admin. MRR should show
         the test ₹3,499 you just paid.

---

## 13 · KMS read-cutover — DONE (S32 Phase 2, 2026-07)

This section is kept for the record; the work shipped:

1. `KMS_BACKEND=gcp-kms` is live in prod (Google Cloud KMS,
   asia-south1, via `GcpKmsProvider` — reuses the Vertex service
   account, no new credential).
2. The read path is decrypt-only (`apps/web/lib/client-pii.ts`) on
   `fullNameEncrypted` / `contactPhoneEncrypted` /
   `contactEmailEncrypted`.
3. The plaintext columns were **dropped**.

Only residue: any pre-cutover row holding old local-dev ciphertext
renders blank until `/admin/encryption/backfill` is run for it.

---

## 14 · Daily ops checklist (what to watch)

Every morning, open these in order:

1. **`/app/admin/funnel`** — yesterday's signups, MRR delta, top
   acquisition sources, cap-event count.
2. **Vercel function logs** — search for `Error` in the last 24h.
   Spike = a cron job or webhook broke.
3. **Razorpay Dashboard → Payments** — sanity-check the count vs
   what the funnel shows. If they disagree by more than 1, the
   webhook is dropping events (unlikely, but worth catching).
4. **WATI Dashboard** — template approval status, any deliverability
   warnings.

If anything alarms, the alert-specific runbooks in this folder are
the next stop:

- High HTTP error rate → `high-http-error-rate.md`
- Cost circuit tripped → `cost-circuit-tripped.md`
- Audit writes stalled → `audit-writes-stalled.md`

---

## 15 · First-customer dry run (do this before any marketing)

The end-to-end you should personally walk through once everything's
live:

1. Sign up as `you+test1@gmail.com` with a real phone you control.
2. Create a fake client (use yourself), record a 5-min dictated
   session.
3. Generate a note, sign it, share to your own email via the
   portal flow. Open the share email — confirm the "Powered by
   Cureocity Mind" footer is there + clicking it lands on
   `cureocitymind.com?utm_source=share_email&...`.
4. Trigger the trial cap by recording 11 sessions (or set
   `BillingAccount.trialSessionCap=0` in Neon SQL Editor for a fast
   path). The Upgrade modal should appear with 4 tier cards.
5. Click "Choose Pro" → pay ₹3,499 via test card (in test mode).
   Webhook fires → account flips to `PRO_MONTHLY` → modal closes.
6. Download the tax invoice. PDF must include your GSTIN +
   18% IGST (if you're in a different state from yourself
   somehow — testing trick: use a client whose state code differs).
7. Try to cancel via Settings → Plan. The "pause instead?" prompt
   should appear. Pause, then resume; confirm `pausedRemainingDays`
   restores correctly.
8. Pretend you're a referral target: open
   `https://app.cureocitymind.com/login?ref=YOURCODE` (your code is
   on the Plan page). Sign up as `you+test2@gmail.com`. Confirm
   `you+test2` got the free 31 days; pay as `you+test2` → confirm
   `you+test1` got the 62-day reward.
9. The next morning, the daily 03:30 UTC cron should have run.
   Search logs for `[billing-reminders]`. If it sent nothing
   (because nothing was within 7 days of expiry), force-test by
   editing `paidThroughAt` to be 3 days out in Neon, then manually
   `curl` the cron with `CRON_SECRET`.

If all 9 steps work for `you+test1@gmail.com`, you can DM your
first real cold lead with confidence.
