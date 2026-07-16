# Changelog

Dated record of substantive changes. Newest first. For the living
operational state, see `docs/PRODUCTION_READINESS.md`; for the domain
architecture, `docs/THREE_PRODUCTS.md`.

---

## 2026-07-16 — Mind landing redesign (neon-blue glass, copilot-forward)

The `mind.cureocity.in` landing (`apps/web/app/page.tsx`) rebuilt from a
user-approved mockup series (v9.3): pure-white base, neon-blue system
(`#2563EB` / `#38BDF8` gradient), glassmorphism (sticky glass pill nav,
frosted cards), Fraunces display serif + Caveat hand annotations, and
copilot-first messaging ("a clinical copilot listens alongside you").

- **`apps/web/app/landing.css`** — the whole landing design system,
  scoped under `.lnd` (keyframes prefixed `lnd-*`) so nothing leaks into
  `/app`, `/for-doctors`, or `/care`. Root uses `overflow-x: clip` (not
  `hidden`) so the sticky nav keeps sticking.
- **`apps/web/components/landing/`** — client islands, all
  `prefers-reduced-motion`-aware: `LandingNav` (sticky glass pill +
  burger menu), `CollageDemo` (hero note that records → drafts → signs on
  loop), `LiveRailDemo` (the during-session copilot rail playing a
  scripted minute; SSR renders the finished state), `EvidencePairs`
  (brief claims ↔ verbatim transcript quotes), `DocsTabs` (the five
  documents, auto-advancing), `WatchItWork` (a built-in 60-second
  8-scene animated explainer — no video file), `LandingFx`
  (scroll-reveal + rotating language word + count-up stats),
  `landing-art` (static SVG illustrations).
- **Font wiring fix (was broken since Sprint 34)** — `@theme` font tokens
  in `globals.css` referenced literal family names (`'Fraunces'`), but
  `next/font` registers hashed names exposed only through its CSS
  variables — so Fraunces never actually rendered anywhere (Georgia
  fallback). Tokens now route through the variables
  (`--font-serif: var(--font-fraunces), …`); added IBM Plex Mono +
  Caveat to the `layout.tsx` font set.
- Honesty rules kept: every claim on the page is a shipped product fact,
  the WhatsApp vignette is labelled an illustration, the pilot section
  says the product is new, no fabricated logos or testimonials.

## 2026-07 — Pilot-readiness push (three products + production hardening)

A multi-part cycle taking the platform from "built" to genuinely
pilot-ready: closing the production-readiness audit's code blockers,
splitting the one platform into three branded products, and completing
the operational configuration. (Runs alongside the parallel Cureocity
Care growth-system work, CG1–CG6 / PRs #102–#108.)

### Three products, one platform (SHIPPED)

Full architecture: **`docs/THREE_PRODUCTS.md`**. One repo, one Vercel
project, one DB, one env — three domains.

- **`apps/web/lib/product.ts`** — the host → product map
  (`mind`/`scribe`/`care`); unknown hosts fall back to `mind`.
- **`apps/web/middleware.ts`** — host-based rewrites so each domain serves
  its own landing at `/`, with canonical 308s; cross-host redirects from
  `mind` gated behind `CANONICALIZE_FROM_PRIMARY` (flipped `true` once DNS
  verified).
- **Onboarding preset by host** (`onboarding/page.tsx` + `OnboardingForm`):
  signing up on Scribe presets `DOCTOR`, on Mind `THERAPIST` (still
  changeable; unknown hosts keep the must-pick flow).
- **Three landing identities** — Scribe indigo, Mind green (unchanged),
  Care warm-charcoal night; each via a page-scoped design-token override,
  the shared system untouched. Privacy + Terms links added to all three
  footers.
- **Care launch boundary** — sign-ups gated behind a **waitlist**
  (`CareWaitlistEntry` + `POST /api/v1/care/waitlist`, audited
  `CARE_WAITLIST_JOINED`, form `CareWaitlistForm`). `CARE_SIGNUPS_OPEN=true`
  flips CTAs to sign-up at launch.
- Domains `scribe.cureocity.in` + `care.cureocity.in` added in Vercel +
  DNS + Firebase authorized domains.

Commits: `ad3c206` (Phase 2 routing), `1aef4ee` (landings + waitlist),
`7871eab` (canonical flip), `6b7632f` (Mind/Scribe legal links).

### Production hardening — the audit's code blockers (SHIPPED, `05e6347`)

Closed every code-side item from the production-readiness audit. Mostly
hardening the Cureocity Care product the parallel session shipped:

- **Care mock refusal on deploy** — `CARE_LIVE_BACKEND` unset/`mock` on a
  deployed env now 503s _before_ a `CareSession` row is created (was
  handing real users a `ws://localhost` credential that burned their
  weekly cap). Backstop throw in `mintLiveCredential`.
  (`apps/web/lib/care-live-token.ts`, `care/sessions/route.ts`.)
- **API-key leak fallback killed** — the ephemeral-token failure path no
  longer embeds the long-lived `GEMINI_API_KEY` in browser URLs on
  deployed environments (fails closed; local dev keeps the fallback).
- **Care sweeper cron scheduled** — `care-session-sweeper` added to
  `vercel.json` (every 30 min); abandoned sessions no longer stick
  `IN_PROGRESS` forever and lock users out of their cap.
- **Crisis escalation alerts a human** — `apps/web/lib/care-crisis-alert.ts`:
  email (`CARE_CRISIS_ALERT_EMAIL`) + Sentry event after the safety-hold
  commits. Audit rows alone woke nobody.
- **Care erasure completes** — the sweeper now hard-deletes `DELETED`
  tombstones past a 30-day grace window (children cascade), audited
  `CARE_ACCOUNT_PURGED`. "Deleted" users' voice transcripts no longer
  persist forever.
- **Care data export** — `GET /api/v1/care/export` (full JSON) + a
  Download-my-data button in Settings, audited `CARE_DATA_EXPORTED` —
  the DPDP access right the onboarding consent always promised.
- **DPDP cross-border enforcement (therapist + doctor)** — `/start` now
  refuses a session whose consent snapshot lacks `CROSS_BORDER_PROCESSING`
  (Pass 2–5 run on the global endpoint); the live-token route no longer
  fabricates a three-scope snapshot; the pre-flight surfaces cross-border
  as a tickable consent and persists it as a standing client Consent row;
  the false "everything stays in India" copy is corrected; the demo client
  seeds all three consents.
- The temporary Vertex-Live probe route was deleted by the parallel
  session (#97); the false `/for-doctors` residency claim was corrected in
  the landing rebuild.

New audit actions: `CARE_ACCOUNT_PURGED`, `CARE_DATA_EXPORTED`,
`CARE_WAITLIST_JOINED` (+ migrations `20260823…`, `20260824…`).

### Operational configuration (console work, this cycle)

- **CRON_SECRET** set + verified (all crons fail-closed 200; the DPDP
  audio-purge caught up).
- **Gateway Sentry activated** — image rebuilt + `SENTRY_DSN` on Cloud Run;
  boot log confirms error reporting.
- **Neon PITR drill** executed + logged (`docs/runbooks/dr-log.md`);
  upgraded to Launch (7-day history).
- **Preview↔prod DB isolation** — Neon `preview` branch created; the
  Neon–Vercel integration scoped to Production-only + manual Preview
  `DATABASE_URL(_UNPOOLED)`. Preview builds no longer migrate/write prod.
- **WebAuthn env** set (`WEBAUTHN_RP_ID=cureocity.in`, `_ORIGINS`,
  `_TICKET_SECRET`) — passkeys were signing with a public dev fallback.
- **`HEALTH_CHECK_TOKEN`** set — the `/health` config block is now gated.
- **SendGrid** — account + domain authentication + Mail-Send-only key +
  `SENDGRID_*` env; the silent crisis-alert no-op is closed.
- **Founder ADMIN grant** on prod (manual SQL on the `main` branch,
  audited `ADMIN_ROLE_GRANTED`).
- **Uptime monitors** — UptimeRobot on the app health endpoint + the
  gateway `/healthz` (5-min, email alerts).

### Load-test harness rewrite (SHIPPED, `9db224c`)

`scripts/load-test.ts` rewritten to drive the real request path
(create → consent → start → end) instead of the dead NestJS scaffolds;
prod-host refusal + `ALLOW_REMOTE` gate + health preflight. Bar: 30
concurrent workflows, zero 5xx, core-step p95 < 1.5s. Parked until
post-pilot scale (`docs/load-test-results.md`).

### Pilot execution kit (SHIPPED, `89392e6`)

- `scripts/pilot-scorecard.sql` — the Friday numbers pull (every playbook
  §3 metric as a labelled read-only section; demo clients excluded).
- `docs/pilot/week0-runbook.md` — the 45-min per-therapist onboarding
  run-of-show + exit checklist.
- `docs/pilot/outreach.md` — recruiting templates + objection cheat-sheet
  - cohort tracker.

### Earlier this cycle (prior windows)

- **Audit remediation AUD1–AUD3** — security headers, chat metering +
  limits, cron fail-closed, chunk cap; mobile fixes + Pass-2 bounds +
  gateway WS hardening; retention truth (audio-purge widen) + DPDP rewrite
  - pilot playbook.
- **NEXT1–NEXT7** — auto-seed demo client at onboarding; reclaim cron for
  stuck drafts; unsigned-note daily digest; gateway per-tenant daily cost
  cap; CI gateway docker-build gate; dependency floors; runbook truth pass.
- **TS7 — low-click UX** — Today "up next" hero, walk-in sheet,
  sign-and-send bar, share-modal memory, one-tap measure; no-show undo
  (Gmail-style 7s undo, `SESSION_NO_SHOW_UNDONE`).
- **Rx gate widened** — meds-free prescriptions (investigations / advice /
  follow-up) enable the Rx PDF + share.
