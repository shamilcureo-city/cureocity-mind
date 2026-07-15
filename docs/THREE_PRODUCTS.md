# Three products, one platform

**Status: SHIPPED (2026-07-14).** Cureocity runs three distinct products
out of **one** git repo, **one** Vercel project, **one** database, and
**one** set of env vars. Products are separated by **domain**, not by
infrastructure. This document is the operational guide to that split —
how it works, how to change it, and what stays deliberately shared.

## The three products

| Product              | Domain                | Audience                                   | Landing route  | Onboards as     |
| -------------------- | --------------------- | ------------------------------------------ | -------------- | --------------- |
| **Cureocity Scribe** | `scribe.cureocity.in` | Doctors (OPD live scribe + Rx pad)         | `/for-doctors` | `DOCTOR`        |
| **Cureocity Mind**   | `mind.cureocity.in`   | Therapists (session copilot + care engine) | `/`            | `THERAPIST`     |
| **Cureocity Care**   | `care.cureocity.in`   | Consumers (AI voice therapy)               | `/care`        | (own auth, D2C) |

`mind.cureocity.in` is the original domain and the **live pilot lives
there** — the split was built so that domain's behaviour never changed.

## Why one project, not three

"Three products" is a **brand split, not an infrastructure split.** Three
Vercel projects (or three repos) would have tripled the cost with no
benefit at pilot scale:

- **Crons would fire 3×** against the same database — including the DPDP
  audio purge, billing reminders, and the Care sweeper.
- **~40 env vars** would become three drifting copies; one forgotten var =
  one silently broken product.
- **Migrations would race** — three simultaneous builds running
  `prisma migrate deploy` against one database.
- **Shared packages** (`contracts` / `llm` / `clinical` / `crypto`) would
  need publishing or duplication; Care already reuses the Journey engine
  and the doctor reuses reliable-change.

The monorepo keeps the door open: graduating a product to its own Vercel
project later (most likely Care, at consumer scale) is a mechanical move,
not a rewrite. Do it only when a real trigger fires (consumer-scale
traffic with a different deploy cadence, a separate team, or a compliance
demand for physically separate infra).

## How it works

### `apps/web/lib/product.ts` — the single source of truth

One `ProductKey = 'mind' | 'scribe' | 'care'` and a `PRODUCTS` map
holding each product's `name`, `host`, `vertical`, and `landingPath`.
`productFromHost(host)` resolves a request's `Host` header to a product;
**unknown hosts (localhost, `*.vercel.app` previews, the bare project
domain) fall back to `mind`**, so existing URLs behave exactly as before.
Everything host-aware (middleware, onboarding) reads from here — never
hardcode a domain anywhere else.

### `apps/web/middleware.ts` — host-based routing

Runs only on the landing/marketing routes (`matcher: ['/', '/for-doctors',
'/care/:path*']`) — never `/api`, `/app`, the portal, or static assets.

- `scribe.cureocity.in` → `/` internally **rewrites** to `/for-doctors`
  (URL stays clean); `/for-doctors` on that host **308-redirects** to `/`.
- `care.cureocity.in` → `/` rewrites to `/care`; `/care` redirects to `/`.
- Cross-host canonicalisation from `mind` (`mind/for-doctors` → the scribe
  domain, `mind/care` → the care domain) is gated behind
  **`CANONICALIZE_FROM_PRIMARY`** (a const in the file). It shipped `false`
  while DNS was propagating and was **flipped to `true`** once both new
  domains verified live — so there is exactly one canonical URL per
  product.

### Per-host identity (page-scoped token override)

Each landing wears its own palette without touching the shared design
system: a page-scoped `style={{ '--color-accent': … }}` override on the
`<main>` element recolors every shared component (buttons, chips,
flourishes) for that product.

- **Scribe** — clinical indigo (`#3a5fa8`) on cool paper.
- **Mind** — the original sage green (unchanged).
- **Care** — warm-charcoal night mode with a clay accent (`#c4634f`), set
  via a full token override in `apps/web/app/care/page.tsx`.

### Onboarding preset by host

`apps/web/app/onboarding/page.tsx` reads the `Host` header and passes a
`presetVertical` to `OnboardingForm`: sign up through the Scribe front
door and the vertical is already `DOCTOR`; through Mind, `THERAPIST`. The
toggle stays visible and changeable, and unknown hosts (previews,
localhost) keep the explicit must-pick flow.

### Separate sessions for free

Cookies are per-domain, so a login on Scribe doesn't exist on Mind —
three products that **feel** like three accounts, while the backend keeps
one `Psychologist` table with the `vertical` flag it already had.

## Cureocity Care — the launch boundary

The Care **landing** is live, but Care **sign-ups stay gated** behind a
waitlist until two blockers clear:

1. **The live-token architecture** — the `vertex` live backend hands a
   broad cloud-platform SA token (the same account that holds KMS decrypt
   over all PII) to consumer browsers. Launch on **ai-studio ephemeral
   tokens**, or add a token-proxying gateway, before enabling `vertex`
   for real users. See `docs/runbooks/care.md`.
2. **The consumer legal surface** — `/privacy` and `/terms` are written
   for clinicians; Cureocity is the _direct_ data fiduciary for Care
   users and needs its own privacy notice + consumer terms (lawyer work).

Until then, the landing shows a **waitlist** (`CareWaitlistForm` →
`POST /api/v1/care/waitlist` → `care_waitlist_entries`, audited
`CARE_WAITLIST_JOINED`). Setting **`CARE_SIGNUPS_OPEN=true`** on Vercel
(+ redeploy) flips every CTA from "Join the waitlist" back to "Start
free". Read the waitlist anytime:
`SELECT * FROM care_waitlist_entries ORDER BY "createdAt" DESC;`

## What deliberately stays shared

| Layer               | Stays as              | Why                                                                 |
| ------------------- | --------------------- | ------------------------------------------------------------------- |
| Database            | one Neon Postgres     | one schema, one migration history, one DR story                     |
| Auth infra          | one Firebase project  | separation is domains + the `vertical` flag, not duplicate identity |
| Live gateway        | one Cloud Run service | doctor + therapist live scribing already share it                   |
| Billing             | one Razorpay account  | plans carry product-specific names; one webhook, one ledger         |
| Crons, admin, audit | one of each           | the ops surface — don't triple it                                   |

## How to change or add a product

**Rename a product or change its accent:** edit `PRODUCTS` in
`apps/web/lib/product.ts` (name/host) and the page-scoped token override
on the relevant landing's `<main>`.

**Add a fourth product:**

1. Add a `ProductKey` + `PRODUCTS` entry in `apps/web/lib/product.ts`.
2. Add a landing route (or reuse one) and its rewrite/redirect rules in
   `apps/web/middleware.ts`, and extend the `matcher`.
3. Add the domain in Vercel (Domains → Add Existing) + a CNAME at DNS +
   the domain to Firebase authorized domains.
4. If it onboards practitioners, handle its vertical preset in
   `onboarding/page.tsx`.

## DNS + domain setup (reference)

Both new domains are CNAMEs to Vercel, added via **Vercel → Domains → Add
Existing** then a CNAME at the DNS provider (Route 53, `cureocity.in`):

```
scribe   CNAME   cname.vercel-dns.com   (or the per-project 558…vercel-dns-017.com)
care     CNAME   cname.vercel-dns.com
```

Firebase → Authentication → Settings → **Authorized domains** must include
both, or Google sign-in fails on the new domains (the pages still load).
`WEBAUTHN_RP_ID=cureocity.in` (the parent domain) makes passkeys work on
both practitioner subdomains; `WEBAUTHN_ORIGINS` lists both origins.

## Files

| File                                            | Role                                        |
| ----------------------------------------------- | ------------------------------------------- |
| `apps/web/lib/product.ts`                       | host → product map (single source of truth) |
| `apps/web/middleware.ts`                        | host-based rewrites + canonical redirects   |
| `apps/web/app/for-doctors/page.tsx`             | Scribe landing (indigo)                     |
| `apps/web/app/page.tsx`                         | Mind landing (green, original)              |
| `apps/web/app/care/page.tsx`                    | Care landing (night) + waitlist gate        |
| `apps/web/components/care/CareWaitlistForm.tsx` | waitlist capture                            |
| `apps/web/app/api/v1/care/waitlist/route.ts`    | waitlist persist + audit                    |
| `apps/web/app/onboarding/page.tsx`              | vertical preset by host                     |
