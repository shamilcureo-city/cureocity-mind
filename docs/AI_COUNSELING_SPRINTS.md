# AI Counseling ("Cureocity Care") — sprint plan

> Task breakdown for [`AI_COUNSELING.md`](AI_COUNSELING.md) — the
> **standalone D2C AI-therapist product**. Sprints AC0–AC7, sized like
> the DV sprints (each lands as one PR-sized unit with its own
> migration where schema changes). Read the build spec first — this
> file is _what to do in which order_, not _why_.

## 0. Definition of Done (every sprint obeys these)

1. **Contracts first** — every DTO in `packages/contracts/src/care.ts`
   with specs; routes use `parseJson`/`parseQuery`. `CareReportV1` is
   a discriminated union on `kind` — always narrow before reading.
2. **Audit coverage** — every new `AuditAction` has a literal-string
   writer or a commented `KNOWN_UNWIRED_ACTIONS` entry; chaos test
   green.
3. **Mock path e2e** — `CARE_LIVE_BACKEND=mock` + `LLM_BACKEND=mock`
   runs the sprint's slice offline, deterministic (mock fixtures exist
   for all three session kinds).
4. **Identity isolation** — every `/api/v1/care/*` route filters by
   resolved `careUserId`; a care cookie never resolves as a
   practitioner or portal client (and vice versa); cross-audience
   access has a test.
5. **One migration per sprint**, `YYYYMMDDHHMMSS_sprint_ac<N>_<desc>`,
   append-only enums via `ADD VALUE IF NOT EXISTS`.
6. `pnpm exec prettier --check .`, lint, `nx build` green; no live
   business logic in `services/` (the mock-live server is a dev tool,
   not a live path).

## 1. Sprint map

| Sprint | Ships                                                               | Depends on                                    |
| ------ | ------------------------------------------------------------------- | --------------------------------------------- |
| AC0    | Live-loop spike: prove the Gemini Live recipe end-to-end            | —                                             |
| AC1    | Front door: `/care` landing + signup + choose-your-therapist        | — (parallel w/ AC0)                           |
| AC2    | Care data model + home + check-ins + session gate                   | AC1                                           |
| AC3    | The live session MVP (the big one)                                  | AC0 + AC2                                     |
| AC4    | The therapy arc: intake → Assessment & Plan → treatment reports     | AC3                                           |
| AC5    | Measurement + review: PHQ-9/GAD-7, reliable change, REVIEW, journey | AC4                                           |
| AC6    | Safety hardening (crisis loop, safety hold, resilience, DPDP)       | AC3 (parallel w/ AC4–5 after 3's route lands) |
| AC7    | Billing, cost guard, observability, launch polish                   | AC5 + AC6                                     |

## AC0 — Live-loop spike (de-risk the one genuinely new thing)

Goal: a dev-flagged page proves browser ↔ Gemini Live with our exact
recipe before any product code depends on it.

- [ ] `packages/llm/src/live/config.ts` — dated model pin, voice list,
      VAD defaults, wire-format constants (§4.1, §4.3–4.5).
- [ ] `scripts/live-probe.ts` — Node probe: connect, setup,
      setupComplete, canned PCM in, audio + both transcription streams
      out, `flag_crisis` tool-call round-trip. Run against
      `ai-studio`; record results for 3.1-flash-live (expected: still
      broken) + the voice/language matrix (open decision #4).
- [ ] Ephemeral-token spike: `auth_tokens.create` with locked
      `liveConnectConstraints`; verify the browser connects with
      `access_token=` and cannot override setup. Document fallback
      behavior if unavailable → `CARE_LIVE_TOKEN_MODE=url`.
- [ ] `services/care-mock-live/` — scripted WS twin speaking the same
      protocol (setupComplete, transcription events, PCM24 audio
      fixture, scripted crisis turn); fixture scripts for INTAKE /
      TREATMENT / REVIEW conversations.
- [ ] Dev-only page `/app/dev/care-probe` (flag-gated): mic in, voice
      out, captions, using `@cureocity/audio` capture + the new 24 kHz
      playback module.
- [ ] Write findings back into `docs/AI_COUNSELING.md` §14 (amend
      decisions #2 + #4 with data).

Exit: a human has a 2-minute voice conversation in the dev page on
both `mock` and `ai-studio`; captions render; token is single-use.

## AC1 — Front door: landing + signup + choose-your-therapist

- [ ] `/care` landing page — server-rendered D2C marketing page,
      `Container`/`ButtonLink`/`Reveal` + `lp-*` layer (mirror
      `/for-doctors` structure) with its own palette + copy; the arc
      (intake → plan → weekly sessions → progress) as the
      how-it-works; disclosure + hotline strip above the fold (S1).
- [ ] `/care/login` — Firebase phone OTP + email-link fallback; signup
      and sign-in unified; care-audience `__session` cookie via the
      `/api/v1/auth/session` pattern (S2).
- [ ] `CareUser` creation on first sign-in; dev bypass resolves a
      seeded demo CareUser when Firebase env is missing.
- [ ] Onboarding flow (S3): display name → choose your therapist
      (persona cards: name + voice sample + gentle/direct style) →
      language(s) → 18+ + disclosure + consent → baseline safety
      question → optional trusted contact → book-first-session;
      `POST /api/v1/care/onboarding`. A _yes_ on the baseline safety
      question routes to hotlines + the licensed-therapist bridge and
      does NOT enable sessions (§2 layer 2).
- [ ] `requireCareUserId(req)` guard;
      `apps/web/app/care/(authed)/layout.tsx` gate.
- [ ] Migration (part 1): `CareUser` + `CareUserStatus`.
- [ ] Audits: `CARE_USER_REGISTERED`, `CARE_ONBOARDING_COMPLETED`,
      `CARE_CONSENT_CAPTURED`.
- [ ] Tests: cross-audience cookie rejection; baseline-safety routing;
      bypass user.

Exit: a new user lands on `/care`, signs up with phone OTP, chooses
their therapist, and reaches an authed home showing "First session —
let's understand what's going on".

## AC2 — Care data model + home + check-ins + session gate

- [ ] Migration (part 2): `CarePlan`, `CareSession` (with
      `CareSessionKind`), `CareReport`, `CareCheckin`,
      `CareInstrumentResponse` + `GeminiPass` adds
      (`PASS_10_CARE_REPORT`, `LIVE_CARE_SESSION`) + remaining
      `AuditAction`s — spec §7 + §11.
- [ ] Contracts: plan/session/checkin/report schemas incl. the
      kind-discriminated `CareReportV1Schema` (§8).
- [ ] Kind-inference lib `apps/web/lib/care-session-kind.ts` — pure
      function over cumulative state (no accepted plan → INTAKE;
      review due by session count / worsening verdicts → REVIEW; else
      TREATMENT), unit-tested — the Sprint-19 convention.
- [ ] Session gate lib `apps/web/lib/care-gate.ts` — pure function:
      safety-hold / tier / weekly-cap verdict with a human-readable
      reason (unit-tested). Used by home (display) and session-create
      (enforcement).
- [ ] `/care/home` (S4): kind-aware next-session card, plan card
      (goals + status, empty state pre-intake), homework card, daily
      mood dial + streak, safety strip; `GET /api/v1/care/home`.
- [ ] `POST /api/v1/care/checkins` + streak computation (pure lib,
      unit-tested).
- [ ] `/care/settings` (S9, minimal): persona/voice, VAD "give me
      time to think" slider, languages, trusted contact.
- [ ] Audit: `CARE_CHECKIN_SUBMITTED`.

Exit: home renders live data with correct kind + gate verdicts;
check-ins persist.

## AC3 — The live session MVP (the big one)

- [ ] `POST /api/v1/care/sessions` — gate check → kind inferred →
      `CareSession` + `startToken` (Redis `EX 2100`; in-memory Map +
      60 s sweeper fallback when `REDIS_URL` unset).
- [ ] `POST .../sessions/[id]/token` — single-use redeem (`GETDEL`) →
      ephemeral token w/ locked setup (server-built, kind-branched
      therapist prompt, §4.8 via
      `packages/llm/src/prompts/care-therapist.ts`, versioned) or
      `url` fallback mode.
- [ ] Pre-flight strip on session start: mood-before dial + mic check
      w/ level meter (folded into the S4→S5 transition; no separate
      page).
- [ ] Live session screen (S5): orb states, captions toggle, timer
      ring, mute, end; `@cureocity/audio` capture → base64 realtime
      frames; 24 kHz playback queue + barge-in flush
      (`apps/web/lib/audio/live-playback.ts`).
- [ ] Turn stitching client-side + `POST .../turns` mirroring (flush
      every finished turn or 3 s; monotonic `seq`; server appends to
      `liveTranscript`, dedupes, responds `{action}` — the crisis
      screen slot returns `continue` unconditionally until AC6 wires
      the real screen, but the contract ships now).
- [ ] `POST .../sessions/[id]/end` — moodAfter, stitch, persist,
      status `COMPLETED`; abandoned-session sweeper (cron route) marks
      `ABORTED` + finalizes from mirrored turns.
- [ ] Report placeholder screen (S6b skeleton; bodies arrive in AC4).
- [ ] Mock-live server wired as `CARE_LIVE_BACKEND=mock`; Playwright
      e2e: signup → onboarding → scripted intake conversation → end →
      transcript persisted.
- [ ] Audits: `CARE_SESSION_STARTED/COMPLETED/ABORTED`.

Exit: full voice session runs on mock offline and on ai-studio with
real audio; transcript lands server-side; caps enforced at create.

## AC4 — The therapy arc: intake → Assessment & Plan → treatment reports

- [ ] Pass 10 full wiring per CLAUDE.md §5: contracts (the
      discriminated `CareReportV1`), kind-branched prompt + version,
      types, Vertex backend (`vertex-care-report.backend.ts`, modeled
      on the already-kind-branched `vertex-clinical.backend.ts`), mock
      twin, `ModelRouter` + `llm.ts`, `recordGeminiCall` union,
      `GeminiCallLog` writes. INTAKE + TREATMENT branches this sprint;
      REVIEW branch in AC5.
- [ ] Trigger in `after()` on `/end` + synchronous
      `POST .../sessions/[id]/report` re-run (Pass-3 pattern);
      markdown-fence stripping + `.catch()` fallbacks; lenient
      mapper.
- [ ] **Assessment & Plan screen (S6a)**: formulation in plain
      language, concern areas w/ the user's own quotes, editable goal
      cards, modality track + cadence, "This is my plan" accept →
      `POST /care/plan/accept` creates versioned `CarePlan` (user
      action, not model action — §5). Audits: `CARE_PLAN_PROPOSED`
      (on report), `CARE_PLAN_ACCEPTED`.
- [ ] Session report screen (S6b): headline, summary, insights w/
      quotes, goal-progress ticks, mood shift, homework (expandable,
      catalog-linked), reflection prompt; share/save.
- [ ] Case-file continuity: accepted plan + last report + homework +
      recent themes feed the next session's prompt (§4.8) and Pass 10
      input; home's plan + homework cards go live.
- [ ] Modality protocol steps: per-track step lists (CBT / BA /
      grounding / sleep) sourced from `@cureocity/clinical` exercises,
      clinician-reviewed, versioned with the prompt.
- [ ] Audit: `CARE_REPORT_GENERATED`.

Exit: signup → intake → Assessment & Plan accepted (goals edited) →
two treatment sessions whose prompts demonstrably carry the plan +
homework forward → reports render beautifully. All on mock, offline.

## AC5 — Measurement + review: instruments, reliable change, REVIEW, journey

- [ ] `POST /api/v1/care/instruments` — PHQ-9/GAD-7 self check-ins
      using the `@cureocity/clinical` instruments registry (items +
      scoring); biweekly prompt on home; `CareInstrumentResponse`
      rows; **item-9 tripwire** → hotline interstitial + safety-hold
      rules (§2 layer 6). Audit: `CARE_INSTRUMENT_SUBMITTED`.
- [ ] Reliable-change reuse: feed the series through
      `change-score.ts`; verdicts computed deterministically and
      passed INTO Pass 10's REVIEW branch (the model explains, never
      re-judges).
- [ ] REVIEW sessions: kind-inference pulls REVIEW forward on
      worsening verdicts; REVIEW prompt branch (§4.8) + Pass 10 REVIEW
      branch (verdicts, goal outcomes, plan changes, recommendation
      incl. forced HUMAN_THERAPIST discussion on worsening);
      `CARE_PLAN_REVISED` re-versions `CarePlan`.
- [ ] `/care/progress` (S7): stage line, instrument trend w/ verdicts
      in plain words, goals across plan versions, mood trend, session
      history; `GET /api/v1/care/progress`.
- [ ] Licensed-therapist bridge stub: static referral page linked from
      REVIEW recommendation + (later) crisis screens (§12).

Exit: a seeded 8-session fixture arc shows intake → plan v1 → biweekly
check-ins → REVIEW with a reliable-change verdict → plan v2 — all
rendered on progress.

## AC6 — Safety hardening (the loop no one else will build properly)

- [ ] `packages/clinical/src/crisis-screen.ts` — deterministic
      keyword/phrase screen, per-language lists (en/hi/ml +
      transliterated code-mix), clinician-reviewed fixture tests;
      wired into `/turns` (screen every batch → `crisis_stop` on hit).
- [ ] `flag_crisis` tool round-trip: model tool-call → client posts
      `/crisis` → server marks `CRISIS_ESCALATED`, records
      `crisisSource`.
- [ ] Crisis takeover UI (S5b): language-filtered
      `INDIA_CRISIS_HOTLINES`, trusted-contact one-tap call,
      licensed-therapist bridge; session already dead server-side.
- [ ] Safety hold: crisis event sets `SAFETY_HOLD`; next-day check-in
      screen + `POST /care/safety/resume`; second event in 30 days
      keeps sessions locked (§2 layer 5); next-day push/WhatsApp nudge
      via `@cureocity/notifications`.
- [ ] Resilience: `session_resumption` handles + `goAway` reconnect +
      context-window compression; turn-mirror rejection after token
      expiry; chaos test: kill WS mid-session → resume within window.
- [ ] DPDP: encrypted companion columns for `CareUser.phone` +
      `CareSession.liveTranscript` (care-user-keyed extension of
      `tenant-crypto.ts`); self-serve export + account deletion in
      settings; `docs/dpdp-data-flow.md` gains the Care section.
- [ ] Audits: `CARE_CRISIS_ESCALATED`, `CARE_SAFETY_HOLD_SET/LIFTED`,
      `CARE_ACCOUNT_DELETED`.

Exit: scripted crisis fixture ends the mock session in <2 s with the
takeover screen; safety hold blocks the next session until the resume
flow passes; WS kill mid-session resumes without losing the
conversation.

## AC7 — Billing, cost guard, observability, launch polish

- [ ] Pricing decision (#3) implemented + `/care/plan-tier` (S8):
      Razorpay checkout for plus (reuse the adapter code; new
      `CareBilling` table — `BillingAccount` stays psychologist-only),
      manage/cancel; gate verdicts reflect tier. Audits:
      `CARE_PLAN_UPGRADED/CANCELLED`.
- [ ] Cost guard: per-user daily Live-minutes budget in
      `cost-guard.ts`; `GeminiCallLog` rows for live sessions
      (duration, tokens, ₹).
- [ ] Metrics counters (§11): signups, activation (intake completed),
      plan-acceptance rate, week-4 retention, sessions by kind, crisis
      by source, reliable-change outcomes, report latency, reconnects.
- [ ] Weekly digest (fast-follow flag): Monday push/WhatsApp with the
      week's mood trend, goal progress + streak.
- [ ] Copy pass with a clinician: intake structure, bridging script,
      disclosure screens, per-track protocol steps, report + plan
      tone; brand + persona names (decision #1) applied across `/care`.
- [ ] Runbook `docs/runbooks/care.md`: token modes, model-pin rotation
      procedure, crisis-escalation on-call flow, mock-live usage;
      load-test note appended to `docs/load-test-results.md`.

Exit: launch checklist green; a test cohort runs three real weeks
(intake + plan + weekly sessions + one review each) end-to-end on
production infra.

## 2. Risks & how the sequencing mitigates them

| Risk                                                                     | Mitigation                                                                                                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live API behaves differently than the recipe (model rotation, token API) | AC0 spike is _first_, isolated, and cheap; dated pins + probe script make regressions diagnosable in minutes.                                                                     |
| The "therapist" experience is generic chat in disguise                   | The arc is structural, not prompt vibes: kind inference, versioned plans, catalog-sourced protocol steps, and case-file continuity are all deterministic code shipped in AC2/AC4. |
| Crisis handling ships late                                               | The `/turns` contract carries `{action}` from AC3 day one; in-prompt bridging rules ship with the first real prompt in AC3; AC6 only strengthens the deterministic screen.        |
| A consumer auth surface opens a data hole                                | AC1 lands the audience-scoped guard + cross-audience tests before any personal data is reachable from `/care`.                                                                    |
| Measurement theater (scores collected, nothing changes)                  | Verdicts are computed by the existing validated engine and force REVIEW scheduling + the human-therapist conversation on worsening — wired as rules in AC5, not model discretion. |
| Cost blowout (native-audio minutes are the COGS)                         | Caps enforced server-side from AC3; per-user budget + tier gating in AC7 before any marketing push.                                                                               |
| Regulatory exposure on the word "therapy"                                | Experience vs label separated by design (§13); the noun is a per-market marketing decision, disclosure is non-negotiable in-app either way.                                       |
