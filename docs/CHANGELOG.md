# Changelog

Dated record of substantive changes. Newest first. For the living
operational state, see `docs/PRODUCTION_READINESS.md`; for the domain
architecture, `docs/THREE_PRODUCTS.md`.

---

## 2026-07-20 — The Session Loop, phase SL1: Close the loop

First phase of the Session Loop model (Prepare → be present → Close the
loop, with the living case formulation as the record's centre of gravity):

- **Living case formulation** — new `CaseFormulation` table, versioned like
  `TreatmentPlan` (supersede + MAX(version)+1 in one tx, audited
  `FORMULATION_CONFIRMED`). Contract `CaseFormulationV1` (narrative,
  maintaining cycle, five Ps, predictions) in
  `packages/contracts/src/formulation.ts`. Pass 3 now proposes
  **formulation-as-diff** updates (`formulationSuggestions` on
  `ClinicalReportV1` — same optional+additive zero-regression pattern as
  `planSuggestions`, normalised defensively in `pass3-normalise.ts`); the
  therapist accepts one suggestion at a time via
  `POST /api/v1/clients/[id]/formulation`, or authors the whole body.
- **Session agreements** — `SessionAgreement` rows ("what we agreed", in the
  client's words where possible; speaker-tagged CLIENT/THERAPIST), with a
  follow-up status (`DONE/PARTLY/NOT_YET`) the next session's Prepare card
  will mark (SL2). Routes under `/api/v1/sessions/[id]/agreements`,
  audited `AGREEMENT_RECORDED`.
- **Alliance one-tap** — `Session.allianceRating` (`ROUGH/FLAT/GOOD/STRONG`)
  via `PATCH /api/v1/sessions/[id]/feedback`, audited
  `SESSION_FEEDBACK_RECORDED`. Drift shows here before the scores move.
- **"Close the loop" surface** — new first sub-tab on the session AI
  Copilot (`CloseLoopBoard`): five moments — what happened (note excerpt) /
  what it means (formulation + accept-able proposed updates with verbatim
  evidence quotes) / what we agreed / is it working (measure delta + the
  alliance read) / anything to watch (crisis flags + open assessment
  questions) — closed by the ONE existing note signature (WebAuthn-stepped
  `postSignNote`), then share. A completed-but-unsigned session now lands
  here by default; signed sessions keep the Review default.
- Migration `20260831000000_sl1_session_loop` (guarded/idempotent). Demo
  client seeds a formulation v1, two agreements, an alliance arc, and two
  formulation suggestions so the surface demos in minute one. Audit chaos
  test gains `KNOWN_NON_AUDIT_ACTION_LITERALS` (FormulationSuggestion's
  `action: 'ADD'|'REVISE'` field collides with the naïve regex).

Next phases: SL2 (Prepare upgrade — read agreements back, formulation
snapshot, due measures), SL3 (full formulation renderer + author editing).

---

## 2026-07-19 — UI truth pass (full-app audit → fixes)

A screenshot audit of every therapist surface (desktop + mobile, live demo
data) found one severity-1 bug, a cluster of coherence issues, and developer
language leaking into clinical UI. All fixed in one pass:

**Bugs**

- **Signed-note attestation** showed the therapist's raw CUID ("Signed by
  cmrs7va4l…"). `NotesTab` now threads the practitioner's display name
  (`signerName`) from the page; the footer renders "Signed by Dr. …".
- **One clock, one format.** New `formatIstDate`/`formatIstDateTime` in
  `apps/web/lib/ist.ts` — "12 Jul 2026, 10:00 am", always IST, never
  seconds. The same session had rendered as `12/7/2026` (header),
  `7/12/2026` (signed line) and server-UTC times on the roster; D/M vs M/D
  ambiguity in a clinical record was the audit's sharpest finding. Swept the
  session header, note footers, session-info tab, and both client pages.
- **Undecryptable client rows** rendered as blank ghosts. The roster and the
  client header now show "Name unavailable" + a "needs encryption backfill"
  badge instead of nothing.
- **Raw internal errors reached the UI**: the pre-session-brief route
  returned the exception text verbatim (webpack module paths in the brief
  panel). It now logs the detail and returns a human retry message.
- Empty-value labels: "Phone" with nothing under it → consistent muted "—"
  on both client surfaces. Conceptual-map empty copy no longer claims the
  client has no recorded sessions.

**Coherence**

- Demo-exclusion made visible: Dashboard/My-practice/checklist zeros next to
  six visible example sessions read as the app contradicting itself. The
  dashboard lib exposes `hasDemoClient`; empty states + checklist hints now
  say "example-client activity isn't counted here". Session Client tab
  relabels "Past sessions/Last session" → "Sessions before this one /
  Previous session".
- The decision board badges a candidate that already IS the active record
  diagnosis ("on record · primary") instead of re-offering it as new; step 5
  is "Lock in a baseline" only until a first score exists, then "Track the
  measures" (a session-6 remission score is not a baseline); wrap-up +
  right-rail labels follow ("Measures").
- Disabled buttons are now visibly disabled (neutral gray, no gradient) in
  `ui/Button` + the board's `Act`.

**Language + polish**

- Jargon out of clinical UI: DPDP card ("audits as the appropriate DSR\_\*
  verb" → plain English), Templates header, settings hints; `spoken: en` →
  "Spoken: English" via new `lib/language-names.ts` (Intl.DisplayNames +
  fallback map); TherapyLibrary chip likewise.
- Signed-note AI panel: real centred explainer instead of an empty column.
  Session-info: full session ID with a Copy chip (new `CopyChip`) instead of
  a truncated id. Mindmap retinted from pre-retheme pastels to the blue
  system. Trial meter labelled "Sessions used". Demo client renamed "Ananya
  Iyer" (the Example badge already marks it; the name doubled it).
- Mobile: board sub-tabs scroll instead of wrapping (no orphaned "Plan");
  the diagnosis-candidate row wraps with the confidence meter on its own
  full-width line instead of squeezing the label to one word per line.

**Structure**

- Client page gains a "View journey & progress →" link (the journey had no
  entry point outside a session's copilot tab).
- The phase-advancement Workflow now has ONE home (the copilot Plan tab);
  the session Client tab links there instead of rendering a second expanded
  copy, and the create-workflow goal placeholder is modality-neutral (was
  panic-specific for every client).
- Deferred deliberately: merging Today/Dashboard/My-practice into fewer
  overview surfaces (a nav-level product decision — proposal noted in the
  audit), and relocating the Templates create button (state lives inside the
  client editor; cosmetic-only).

## 2026-07-17 — Copilot IA redesign · R3b (two next-session stores, disambiguated)

Final phase: the audit found next-session questions living in **two
disconnected stores** rendered as if they were one list — they could (and
would) silently disagree. The two are genuinely different concepts, so R3b
**names them apart and cross-links them** rather than force-merging the data
model (which would have touched the care engine, Pass-5, and the therapy-
reasoning backend for no clinical gain):

- **The assessment ledger** (`AssessmentItem` rows) — the durable, ranked,
  stale-flagged, closeable record of _what's still open to establish_ about
  the client. It gates the diagnosis and shrinks as assessment resolves.
- **The carry-picks** (`Client.carriedQuestions`, ≤8) — the questions the
  therapist deliberately ticks to _seed the next session's AI opening
  brief_ (Pass-5). A forward-looking pick-list, not a ledger.

What changed (UI copy + one cross-link fetch — **no contract / schema /
route / engine change**, so zero data-model risk):

- **Progress · "Next session" card** (`CareNextSessionPanel`) — the
  `AssessmentItem` list is relabelled from the ambiguous "Carry into the
  session" to **"Still open to establish"** (it's the ledger, closeable). A
  new **"Carried for the opening brief"** subsection now mirrors the actual
  carry-picks read-only, with a "Change on Review →" link — so the ledger,
  the carry-picks, and the AI brief they feed read as three distinct things
  on one card.
- **Review · board step 3** (`AskNextStep`) — the sub-copy now says ticks
  "seed next session's AI opening brief", and a footnote cross-links to the
  full open-questions ledger on the **Progress tab**.
- **Wiring** — `AICopilotTab`'s Progress sub fetches
  `Client.carriedQuestions` (defensive `CarriedQuestionSchema` parse) and
  passes it + the Review href to the panel.

Verified end-to-end against the offline mock: Progress shows the ledger
("1 open", closeable) above the two carried picks ("Change on Review →")
above the AI brief; the board's step 3 footnote links to Progress; the
right-lane "Next session will open with" still mirrors the carry-picks.

## 2026-07-17 — Copilot IA redesign · R3a (plan-as-diff)

Fourth phase: on a **follow-up** session the copilot proposes **edits** to
the therapist's existing plan instead of a whole competing plan — the last
piece of "the AI proposes, you own the plan".

- **Contract** — `ClinicalReportV1` gains an OPTIONAL, additive
  `planSuggestions: ClinicalPlanSuggestion[]` (typed diffs: `ADD_GOAL` /
  `REVISE_GOAL` / `REMOVE_GOAL` / `ADJUST_DURATION` / `CHANGE_MODALITY`,
  each with a one-line rationale). `.default([])` means every existing
  stored report still parses.
- **Zero-regression by design.** planSuggestions is optional and the board
  falls back to the full-plan flow when it's empty, so if real Gemini
  doesn't populate it the therapist sees exactly today's behaviour — no
  possible regression. (Verified against the offline mock; the real
  Vertex plan-diff behaviour still wants a clinician glance before it's
  trusted in prod.)
- **Prompt** — Pass-3 (`CLINICAL_ANALYSIS_SYSTEM_PROMPT` → version bumped
  to `…_V3`) instructed: with a prior plan present, echo it into
  `treatmentPlan` and put changes into `planSuggestions`; with none, emit a
  full plan and leave suggestions empty. Mock emits sample suggestions when
  a prior plan is in context.
- **Normaliser** — `normalisePass3Output` canonicalises each suggestion's
  `type` and DROPS any unappliable one, so a bad suggestion never sinks the
  whole report (same safety philosophy as the crisis / gap normalisers).
- **Accept route** — `POST /clinical-reports/[id]/plan-suggestion` applies
  ONE suggestion to the active plan → a new versioned `TreatmentPlan`
  (audited `PLAN_CONFIRMED`, `source: PLAN_SUGGESTION`). Verified: accepting
  an `ADD_GOAL` took the demo plan v1 (2 goals) → v2 (3 goals), v1
  superseded.
- **Board** — step 4 "Plan update" renders the suggestions as accept-able
  diff cards (with the current plan summary + a "full plan (reference)"
  disclosure) when a plan already exists; the full "Suggested plan" flow now
  runs only for a first plan.

## 2026-07-17 — Copilot IA redesign · R2 (the Plan tab)

Third phase, and the centre of the audit: **the therapist's treatment plan
finally has a home.** The sub-tab named "Plan & toolkit" rendered a
conceptual map, diagnosis history, a therapy library, and a "Workflow"
form — but never the client's actual `TreatmentPlan`, which had no full
in-app view anywhere (the founder's complaint: "the plan of psychologist
should be there").

- **New `PlanHero`** (`components/app/PlanHero.tsx`) leads the tab: the
  active plan's modality + expected duration, version (+ how many versions
  are on record), the anchored primary diagnosis, the phase sequence, and
  every goal with its **live achievement status** — toggled through the
  existing `/treatment-plans/[id]/goals/[index]` route (writes
  `TreatmentGoalProgress`, never re-versions the plan). An empty state
  points to a session's Review tab when no plan exists yet.
- **The tab is renamed "Plan"** (was "Plan & toolkit") — now that it shows
  a plan. Hint: "The client's plan — yours; AI can only suggest".
- **"Workflow" is demoted, not deleted.** The CBT/EMDR phase-advancement
  engine (a parallel plan-like object with its own goals) moves into a
  collapsed "Phase advancement tracker (CBT / EMDR) — optional" section at
  the bottom, clearly labelled as a separate aid — so it stops reading as a
  second plan. The therapy library, diagnosis history, and conceptual map
  remain as supporting cards.
- Loader lives in `AICopilotTab`'s `PlanSub` (renamed from `FormulationSub`):
  active plan body + `TreatmentGoalProgress` + version count + primary
  diagnosis, composed into `PlanHeroData`.

## 2026-07-17 — Copilot IA redesign · R1 (renames + relocations)

Second phase: the naming + information-architecture cleanup, no data or
contract changes. Directly addresses the audit's "what is this called /
where does it live" findings.

- **The three copilot sub-tabs are renamed** to plain questions:
  `This session` → **Review** ("What the copilot heard — you decide"),
  `Journey` → **Progress** ("The arc · is it working · next session").
  The third stays "Plan & toolkit" until R2 gives it a real plan. URL sub
  keys changed to match (`review`/`progress`/`plan`); every legacy key
  (`session`/`journey`/`measures`/`briefing`/`formulation`) redirects, so
  old bookmarks keep working. The decision-board header is now "Review this
  session" (was "This session's reading").
- **Mindmap and reflection questions left the decision flow.** The mindmap
  (a view of the note) moved to the **Transcript** tab; reflection
  questions (client-facing) moved to the **Notes** tab. The Review board
  leaves a quiet "Also from this session →" link row. Old `?tab=mindmap` /
  `?tab=reflection` bookmarks redirect to the new homes.
- **"Care journey" is retired** (it collided with the Cureocity Care
  product) — the Progress arc card is now "Treatment arc". Gamified
  wording dropped: "M of N earned" → "N of M done", "Earns: X" → "Moves
  to: X".
- **Diagnosis is shown once, as a pointer to its home.** The Progress arc
  header dropped the contradictory "Current best fit (provisional — may
  change)" restatement (which fought the "confirmed" framing on the Review
  rail); it's now "Working diagnosis" with a "diagnosis + plan live on
  Plan ↗" link.
- **One verdict vocabulary across therapist surfaces.** The measures-trend
  card said "Steady" while the Progress "Is it working?" card said "No
  reliable change" for the same deterministic verdict; both now say "No
  reliable change" (the client-facing progress report keeps its own
  plain-language wording).

## 2026-07-17 — Copilot IA redesign · R0 (clinical-safety fixes)

First phase of the therapist-copilot information-architecture redesign
(from the 17 Jul UX audit). R0 fixes three verified clinical-safety
defects in the decision board, independent of the wider IA rework:

- **Intake sessions now gate on crisis flags (D·18).** A high/critical
  safety flag on a first-ever session used to leave the whole board
  interactive (`crisisAcknowledged` was hardcoded `true` for intake) with
  no acknowledge action and no `CRISIS_ACKNOWLEDGED` audit. Intake now
  gates steps 2-6 (and the record rail) until the therapist either has a
  safety plan on file or explicitly acknowledges — via the new
  `POST /clinical-reports/[id]/intake-crisis` route (the shared sections
  route can't confirm crisis on an intake, whose body is an
  `InitialAssessmentBriefV1`, not a `ClinicalReportV1`). Reuses the
  existing `CLINICAL_SECTION_CONFIRMED` + `CRISIS_ACKNOWLEDGED` audits.
- **Accepting a diagnosis no longer silently wipes comorbid ones (C·19).**
  The accept used to supersede _every_ active `ClientDiagnosis` and rebuild
  from the session's candidates, so a comorbid diagnosis from an earlier
  session (not in today's list) vanished unseen. The board now shows those
  as pre-ticked "Already in the record — keep or retire" rows; only unticked
  rows are superseded (new optional `keepDiagnosisCodes` on the sections +
  intake-diagnosis write paths, empty = legacy behaviour). Treatment
  selection also starts **empty** (was pre-select-all), so no habitual click
  rewrites the record. Honest copy names what will be retired.
- **The board no longer shows the AI's plan as the plan of record (A·02).**
  Once the plan section is confirmed, step 4 becomes "Plan update": it shows
  the record plan (version, modality, goal count) with a link to the Plan
  tab, flags when an "Edit & accept" made the saved plan differ, and
  collapses the AI's original suggestion behind a disclosure. The Clinical
  Brief PDF's plan section is retitled "Treatment plan — AI suggestion" with
  a caption clarifying it isn't necessarily the plan of record.

## 2026-07-17 — Care "Proper Psychologist" plan (CP1–CP8) — design doc

`docs/CARE_PSYCHOLOGIST.md` added: the audited diagnosis of why Care
sessions auto-wrap (unhandled WS close → `endSession()`, a clockless
model ordered to timekeep, unconditional `end_session` obedience, no
resumption/reconnect path) and the eight-sprint plan to make Care a
proper psychologist — CP1 clock authority + negotiated endings +
resumable transport, CP2 the live structure engine (six tools + phase
rail + `CareLiveEvent`), CP3 baseline battery + graded risk ladder,
CP4 5-Ps formulation + My Plan, CP5 manualized mastery-gated arcs +
toolkit, CP6 document-grade reports + archive, CP7 measurement every
session + case file, CP8 e2e/probe/observability proof. Plan only — no
behaviour change in this commit. CLAUDE.md doc map updated.

## 2026-07-17 — Inner app carried onto the landing's design system

The authenticated shell (`/app/*`), login, and portal now share the
landing's neon-blue glass system. Because the whole app styles through
the `@theme` tokens in `apps/web/app/globals.css`, most of this is one
token swap: warm-paper green (`#faf7f2` / `#2d5f4d`) → cool-white blue
(`#f7f9fd` / `#2563eb`, hover `#1d4ed8`, soft `#e8effc`, new
`--color-accent-bright: #38bdf8`). Ink/line values match `landing.css`.
`/for-doctors` (indigo) and `/care` (warm charcoal) keep their own
page-scoped overrides and are unaffected.

- **Chrome** — Sidebar and mobile bottom bar are translucent glass
  (`bg-white/65 + backdrop-blur`) over a new `.app-wash` fixed radial
  glow layer (the landing's washes at half strength). Active nav items
  use the accent-soft pill. The sidebar wordmark is the landing brand
  mark (gradient tile + pulse line) and is vertical-aware: therapists
  see "Cureocity _Mind_", doctors "Cureocity _Scribe_".
- **Primitives** — `Button` primary is the landing gradient
  (`#38BDF8→#2563EB`) with the blue glow shadow; secondary hovers to
  accent. `Card` gains the landing's soft double shadow.
- **Login** — both brand marks (desktop rail + mobile head) updated to
  the gradient mark with the italic-blue product word.
- **Hardcoded greens swept** — `opengraph-image`, `global-error`,
  `DoctorLiveEncounter` (voice-command chip), `MindmapTab` (flood
  color), `ClinicalBriefPdf` accent now use the blue system.
- Fraunces page headings render app-wide as a side effect of the
  2026-07-16 font-token fix (pages already used `font-serif`).

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
