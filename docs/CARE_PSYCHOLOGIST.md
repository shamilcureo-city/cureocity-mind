# Cureocity Care — The Proper Psychologist (CP1–CP8)

> **Status: APPROVED PLAN — build not started.** This is the design +
> sprint plan for making Care's clinical experience worthy of the name:
> sessions that cannot auto-wrap, a session with a visible spine, a real
> assessment before a plan, document-grade reports, and measurement at
> every contact. It was produced from a full code audit (every claim in
> §1 carries file:line evidence that was read, not assumed). Companion
> docs: `docs/AI_COUNSELING.md` (the build spec this extends),
> `docs/CARE_GROWTH_SYSTEM.md` (the growth system + ethics charter —
> every invariant there binds this plan).

---

## 0. The mandate

The founder's verdict on the current experience, verbatim: _"the
assessment, therapy and all part of this care is not so good. when
anything says it is auto wrapping up.. no structure, no proper report
page.. nothing amazing in this. i want this to be a proper
psychologist."_

That is four complaints, and the audit confirms all four are real,
code-level defects — not prompt-tuning problems:

1. **Sessions auto-wrap** — for transport and timekeeping reasons that
   have nothing to do with therapy.
2. **No structure** — the session is one static prompt; nothing enforces
   or even displays a session shape.
3. **No proper report** — the report is reverse-engineered from a raw
   transcript and rendered thin.
4. **Not a psychologist** — nothing is measured before the plan is
   written, risk is a boolean, the case file a clinician would keep does
   not exist.

## 1. Diagnosis — what the code does today (verified)

### 1.1 Transport death masquerades as therapy (the literal auto-wrap)

Any WebSocket close at phase `live` unconditionally calls `endSession()`
— "Wrapping up…" + redirect to the report
(`CareLiveSession.tsx:320-327`). Gemini Live connections have finite
lifetimes and announce shutdown via `goAway`; we request
`session_resumption` in the setup (`live/config.ts:129`) but **no code
consumes the handles or `goAway`** (repo-wide grep: docs only). The
start token is single-use and destroyed on read
(`CareLiveSession.tsx:258-264`), the AI-Studio ephemeral token is
`uses:1` with a 2-minute new-session window
(`care-live-token.ts:207-227`). So a network blip, a Gemini lifetime
cut, or a page refresh **is** a session end — indistinguishable from a
natural close.

### 1.2 A clockless model is the only timekeeper

The prompt orders "At N minutes, begin closing"
(`prompts/care.ts:113/121/143/159`) and the `end_session` tool says
"when… time is up" (`live/config.ts:147-150`) — but a native-audio live
model has **no wall clock**, and the only text ever sent after setup is
the one-time greeting cue (`CareLiveSession.tsx:174-193`). It guesses,
and it guesses early. The client then **obeys any `end_session`
instantly** — no elapsed-time guard, no user confirmation, and no
`tool_response` channel exists to decline (grep: zero matches).

### 1.3 The clock itself is dishonest

The countdown starts at component mount, so token-redeem + connect +
setup latency is deducted from therapy time
(`CareLiveSession.tsx:49,339-349`); at zero it hard-kills mic + WS
mid-sentence. The `onerror`/`onclose` race either fakes a natural close
or strands the session `IN_PROGRESS` for the 45-minute sweeper — losing
usage metering either way. In dev, the mock server fires `end_session`
the moment its script runs out (`care-mock-live/server.ts:150-158`) —
the team has been trained to accept auto-wrap as normal.

### 1.4 No enforceable structure

One advisory "SESSION SHAPE" prompt line; exactly two tools
(`flag_crisis`, `end_session`); zero mid-session steering; no
phase/agenda state anywhere; a live UI of orb + countdown + one caption.
Structure is invisible to the user and unverifiable by the system. Pass
13 (the report) reverse-engineers everything from the raw transcript.

### 1.5 The plan is formulated before anything is measured

Baseline PHQ-9 appears only AFTER plan acceptance and is permanently
dismissible; GAD-7 is fully built but **never administered** (every call
site takes the PHQ9 default). Risk is binary at every layer: one
onboarding boolean, and PHQ-9 item-9 > 0 trips a full `SAFETY_HOLD`
identically for passive thoughts and nearly-every-day intent. Crisis
sessions get no report at all.

### 1.6 The case file a psychologist would keep does not exist

The formulation is one prose paragraph — history, strengths, supports
are elicited in the intake conversation and then **discarded by the
schema**. The "protocol" is six one-liners cycling forever on
lifetime-count % 6, misindexed after track switches, with no mastery
gating and no arc completion.

### 1.7 Measurement-based care is dark between baseline and session 6

No per-session ratings; no mid-cycle instruments; `worseningVerdict`
hardcoded `false` at five call sites; a nadir relapse (18→8→16) is
invisible under first-vs-latest deltas. Deterioration cannot pull a
review forward.

### 1.8 Reports are not documents

No masthead (the data is already returned); timestamps discarded at
stitch; goals rendered as bare indices ("Goal 1: ▲"); `moodAfter`
always null when the report generates; `why`/`measure` generated but
never shown; `.catch()` renders hollow cards; no truncation honesty; no
archive. And the nav item "Plan" opens **billing**.

## 2. The design law

> **The LLM converses; deterministic code keeps time, structure, risk
> grading, scoring, and curriculum state** — exactly the things a
> skilled clinician never leaves to intuition.

Everything below follows from that law, in four layers:

- **Layer 1 — un-killable, time-honest sessions** (CP1, ships alone and
  fast): the browser becomes the clock authority; endings become
  negotiated; transport death becomes a reconnect.
- **Layer 2 — the structure engine** (CP2): six Zod-guarded tools the
  model calls to drive UI + persistence, a pure phase engine with
  deterministic steering, structure rendered live.
- **Layer 3 — clinical depth on the engine** (CP3–CP5): measured
  baseline before formulation + a graded risk ladder; a 5-Ps cumulative
  formulation with a real My Plan home; manualized mastery-gated
  protocol arcs + the skills toolkit.
- **Layer 4 — the record + the proof** (CP6–CP8): document-grade
  reports and a longitudinal case file built ONLY from data the engine
  actually produces; then e2e tests, wire probes, observability, and a
  doc-truth pass.

Architecture constraints that bind every sprint: browser↔Gemini Live is
direct (the server only sees mirrored turns), so all live steering rides
the client + prompt + tool-calls, with the existing 3-second
turns-mirror response as the only server→client channel (Vercel-safe, no
new sockets). Cue/steering/reconnect text never enters the mirrored
transcript or the report input.

## 3. The sprints

### CP1 — Kill the auto-wrap: clock authority, negotiated endings, resumable transport

**Goal.** A Care session can only end three ways — the user taps end,
the clock runs out AFTER a spoken wind-down, or crisis. A network drop,
`goAway`, or page refresh is a reconnect, never an ending; genuine
failures finalize honestly instead of dead-ending.

**Builds.**

- Sync `remainingSec` to `setupComplete` (connect latency stops eating
  therapy minutes). Silent time cues over the proven `client_content`
  channel at setup+0, every 5 min, T-5, T-2 ("begin your closing summary
  NOW"), T-0 — one home in `packages/llm/src/live/cues.ts`, sent only
  between model turns, never mirrored into the transcript.
- Prompt V4 (clinician-signed; deployed separately from any model-pin
  change): delete every "At N minutes, begin closing" line; add the
  time-cue contract ("close ONLY on the wind-down cue; a declined
  end_session means keep going"); remove "or time is up" from the
  `end_session` tool description.
- Gate `end_session`: capture the functionCall id; decline via
  `tool_response {accepted:false, minutes_remaining, instruction}`
  whenever `remainingSec > 180` and the user hasn't tapped end. Accepted
  ends get ≤20 s of goodbye playback; T-0 enters a "closing" grace
  state; force-finalize only at T+90 s (inside the `/turns` +5 min
  server grace).
- Resumable transport: store `sessionResumptionUpdate.newHandle`; treat
  `goAway.timeLeft` as a pre-emptive reconnect signal; on close with
  > 2 min remaining enter phase `reconnecting` (countdown keeps ticking,
  > mic paused), single-flight 3 retries (1s/2s/4s), reopening with
  > `session_resumption:{handle}`.
- New `POST /api/v1/care/sessions/[id]/reconnect-token`: owner-authed,
  `IN_PROGRESS` + inside cap+grace only, re-mints the credential without
  the destroyed sessionStorage start token; rate-limited per session;
  audited `CARE_LIVE_RECONNECTED` (literal writeAudit + guarded enum
  migration).
- Degrade path when the handle is missing/rejected: fresh connect + a
  re-entry cue synthesized from the last ~6 mirrored turns
  ("[RECONNECT] the call dropped; you were discussing X — resume gently,
  do not restart"). Proactive reconnect 60 s before
  `credential.expiresAtMs` (already returned; currently unused).
- One `finalize(reason)` path with an `endedReason` enum
  (`natural|user|timeout|disconnected|crisis`) on the `/end` POST;
  `onerror` only logs and defers to `onclose`; reconnect exhaustion
  finalizes as `disconnected` and the report generates immediately (no
  45-minute sweeper wait). Usage banked per-connection and summed;
  `navigator.sendBeacon` on pagehide so closed tabs stop losing COGS.
- Refresh survival: the session page detects `IN_PROGRESS` + missing
  start token → "Rejoin session" via reconnect-token, instead of "This
  session link has expired".
- Mock-server parity in-sprint: accept `tool_response` frames, emit
  `sessionResumptionUpdate` + `goAway` fixtures, stop firing
  `end_session` on script exhaustion; add premature-end-at-minute-2 and
  mid-session-drop fixtures.
- Probe before prod flag-on (both backends): `tool_response` round-trip,
  resume-with-handle, `goAway` observation, and a 10-minute soak
  asserting cue text never appears in output transcription. Ship behind
  `CARE_LIVE_ENGINE_V2` (off = byte-identical rollback).

**Acceptance.**

- Kill the WS at minute 3 (mock fixture): "Reconnecting…" shown, session
  resumes within ~5 s with continuous transcript seq, report NOT
  generated, "Wrapping up…" never appears for a drop.
- A fixture `end_session` at minute 2 of 25 is declined via
  `tool_response` and the session continues to cap; a user-tapped end
  always works immediately.
- Countdown starts at `setupComplete`; a session reaching cap gets the
  T-2 wind-down cue, a spoken closing exchange, and finalizes by T+90 s
  — never a mid-sentence mic/WS kill.
- Page refresh mid-session offers Rejoin (<10 s); 3 failed reconnects →
  `finalize('disconnected')` → report loads immediately with usage
  relayed; zero sessions stranded `IN_PROGRESS` in chaos tests.
- Zero cue or reconnect-prime text in mirrored `CareTurn` rows or Pass
  13 input.
- Probe green on AI Studio AND Vertex before the flag defaults on
  anywhere deployed; prompt V4 clinician-signed; audit chaos test green;
  migration passes `pnpm db:check-migrations`; flag-off byte-identical.

**Files.** `CareLiveSession.tsx`, `packages/llm/src/live/cues.ts` (new),
`live/config.ts`, `prompts/care.ts`,
`api/v1/care/sessions/[id]/reconnect-token/route.ts` (new),
`.../end/route.ts`, `lib/care-live-token.ts`, `contracts/src/care.ts`,
`contracts/src/audit.ts`, one guarded migration,
`services/care-mock-live/src/server.ts`, the session page.

### CP2 — The structure engine: tools, phase rail, steering, persisted live events

**Goal.** Session structure becomes machine-readable state the model
drives, the user sees, deterministic code enforces, and every later
sprint consumes — agenda, phases, moments, worksheets, homework, and
goal ratings as audited `CareLiveEvent` rows, not prose
reverse-engineered from transcript.

**Builds.**

- `packages/contracts/src/care-live-tools.ts` (new): Zod schemas for
  `set_agenda{items 1-5 ×≤120ch}`, `mark_phase{per-kind enum}`,
  `log_moment{type INSIGHT|QUOTE|SKILL, text≤300, quote?≤500}`,
  `worksheet_update{worksheetKey enum, fields}`,
  `assign_homework{title, steps 1-5, whyItHelps}`,
  `record_goal_rating{goalIndex 0-5, rating 0-10}` +
  `CareLiveEventSchema{type, payload, atMs, seq}`.
- Six `function_declarations` added to `buildCareLiveSetup`; prompt V4.1
  with per-kind when-to-call guidance (clinician-signed); a dispatcher
  that Zod-parses args and answers EVERY call via `tool_response`
  (accepted / rejected-with-reason) so the model self-corrects.
- Deterministic anti-spam guards: `set_agenda` ≤1/2min, `mark_phase`
  monotonic-only, `log_moment` ≤12/session with a verbatim-quote check
  against recent mirrored turns (anti-Barnum), `assign_homework`
  ≤2/session, `worksheet_update` ≤1/10s — violations rejected via
  `tool_response`, never silently dropped.
- `apps/web/lib/care-phase-engine.ts` (new, pure, unit-tested): per-kind
  phase graphs with minute budgets — INTAKE
  open→presenting→context→history→risk→strengths→close (risk REQUIRED);
  TREATMENT check-in(5)→agenda(2)→work(N)→summary(2)→homework(2); REVIEW
  goal-walk. Inputs: elapsedSec, `mark_phase` events, coverage flags;
  outputs: expectedPhase, lagging?, requiredUncovered[]; timer-only
  fallback when the model never calls `mark_phase`.
- Steering cues when lagging ("[STEERING — silent] 10:00 remain and no
  agenda is set — propose one and call set_agenda"), max 1 per 2 min,
  never during model speech, riding the CP1 cue channel.
- Server coverage rail: extend the 3 s turns-mirror response (the proven
  `crisis_stop` channel) with `directives[]` computed deterministically
  in `apps/web/lib/care-coverage.ts`; the client converts directives to
  cues; backward-compatible schema.
- Coverage-gated endings: `end_session` accepted only when
  `requiredUncovered` is empty OR `remainingSec < 120` OR the user
  tapped end; the decline names the gap ("you have not asked about
  safety — do that gently first"). The hard cap is NEVER extended — the
  report discloses uncovered domains instead.
- Live UI: `LiveAgendaStrip` (agenda + goals-in-play chips), ambient
  phase dots, moment toast ("✦ noted", 2 s), homework confirmation card
  (the user's ✓/✗ tap IS the accept, persisted as its own event),
  goal-rating chip, worksheet drawer (slide-up half-sheet,
  user-editable, "Keep this" confirm).
- Persistence: batched `POST /api/v1/care/sessions/[id]/live-events` on
  the existing 3 s flush cadence — owner-authed, Zod-validated,
  idempotent by `(sessionId, seq)`; `CareLiveEvent` table (one guarded
  migration); four literal writeAudit actions (`CARE_LIVE_AGENDA_SET` /
  `CARE_LIVE_MOMENT_LOGGED` / `CARE_LIVE_HOMEWORK_AGREED` /
  `CARE_LIVE_EVENT_RECORDED`).
- Pass 13 upgrade: `care-case-file` stitches `CareLiveEvent` rows into
  the report input (timestamped keyMoments, homework-as-agreed with the
  user's accept/decline, goal ratings, phase/coverage summary).
- Session-starter upgrade: home topic chips become plan-aware (open
  goals, last homework, open threads) instead of 4 hardcoded strings.
- Mock fixtures per kind exercising every tool at realistic beats, plus
  a 50-log_moment spam fixture and a zero-tools fixture proving tools
  are strictly additive.

**Acceptance.**

- Mock e2e per kind: agenda strip populates, phases advance, ≥2 moments
  toast, homework accept/decline lands in `CareLiveEvent`; a session
  where the model calls no tools behaves exactly as CP1 left it.
- A mock INTAKE that never asks the risk question receives a steering
  cue AND an `end_session` decline naming risk; if still uncovered at
  cap, the report discloses it.
- Spam/invalid-args fixtures produce `{accepted:false}` tool_responses
  with zero UI/DB effect; live-events idempotent under flush retries.
- `care-phase-engine` spec: full branch coverage; pure, no I/O;
  timer-only fallback walks phases and closes cleanly.
- The report for a tooled session lists timestamped key moments and the
  exact agreed homework — not an LLM reconstruction; `log_moment` quotes
  verified verbatim against turns.
- Audit chaos test green (four literal actions); migration idempotent;
  agenda rail + worksheet drawer render on a 360 px viewport without
  occluding captions/mute/end/crisis; no code path extends past
  cap+90 s; `/turns` response change backward-compatible; tool_response
  re-probed on both backends before flag-on.

### CP3 — Measure before formulating: baseline battery + graded risk ladder

**Goal.** The plan is grounded in numbers taken BEFORE it is written;
anxiety gets measured; risk gets a graded clinician-authored ladder
instead of a boolean and a hair-trigger; the highest-acuity session
finally leaves a record.

**Builds.**

- Pre-intake baseline ritual: PHQ-9 + GAD-7 back-to-back, ≤3 min,
  before the first session (`CareInstrumentForm` call sites finally pass
  `instrumentKey`); the `/care/check` anonymous score imports as
  baseline on signup; skip is honest ("your plan will start
  unmeasured"), per-session only, re-offered before plan accept — the
  permanent localStorage dismissal is removed.
- WHO-5 added to the registry as an optional wellbeing item
  (public-domain wording, provenance documented per instrument); the
  SLEEP track gets a structured sleep-diary form — explicitly NOT ISI
  (licensing).
- `packages/clinical/src/risk-ladder.ts` (new): original plain-language
  rungs — passive ideation → active ideation → plan → intent →
  means/access — plus protective-factors items; clinician-authored,
  demonstrably NOT C-SSRS wording; the rung persists as structured
  `riskFormulation`.
- Graded item-9 handling: value 1 → warm in-app ladder follow-up +
  check-in (no hold); value 2-3 or ladder ≥ PLAN → `SAFETY_HOLD` +
  bridging script exactly as today (the crisis path is unchanged, never
  gated). The onboarding boolean becomes the short ladder screen;
  `flag_crisis` severity maps through the ladder; the CP2 coverage rail
  marks the intake risk domain covered when the ladder or risk
  conversation lands.
- Remove `riskScreen` `.catch('NONE')`: malformed Pass 13 risk output →
  `NEEDS_REVIEW` flag + conservative handling, never silent NONE.
- The crisis route gains `after()` → a compassionate report branch; the
  safety-resume flow reads the ladder rung.
- Baseline scores + severity bands injected into the intake case file;
  the Pass 13 INTAKE branch conditions formulation/track/cadence on
  measured severity (the model explains, never re-judges); the intake
  report gains a Measures & Scores section in plain words.
- Severity-adaptive cadence in `inferCareSessionKind` (pure,
  unit-tested): severe baseline → review every 3 sessions + an honest
  human-therapist suggestion surfaced at the intake report.

**Acceptance.**

- A new user cannot reach an accepted plan with zero instrument data:
  skip allowed once, re-offered before plan accept, never
  dark-patterned.
- GAD-7 administered and scored end-to-end; an anxiety-primary user's
  verdicts run on GAD-7.
- Item-9 = 1 produces the ladder follow-up, not an instant
  `SAFETY_HOLD`; item-9 = 3 or plan/intent still holds immediately;
  every branch audited with literal actions.
- A `CRISIS_ESCALATED` session produces an automatic report within 90 s.
- Severe PHQ-9 (20-27) changes cadence and surfaces the human-therapist
  line (unit tests on `inferCareSessionKind`).
- Every ladder rung, threshold, and copy string carries clinician
  sign-off in the PR; instrument provenance documented; no machine
  translation. Seven-layer safety model regression-free.

### CP4 — 5-Ps formulation, cumulative case file, and a real My Plan home

**Goal.** The intake produces a structured case formulation that
persists whole, travels into every session prompt, gets updated rather
than rewritten — and the therapeutic plan gets a real page while the nav
stops calling billing "Plan".

**Builds.**

- Extend `CareAssessmentAndPlanSchema`: `fivePs {presenting,
predisposing, precipitating, perpetuating, protective}`,
  `problemList[]`, `historySummary`, `strengthsSupports[]`,
  `riskFormulation` (ladder rung + protective factors),
  `baselineScores` — no migration needed (`CarePlan.formulation` is
  already Json).
- The intake prompt branch rewritten to elicit and LAND each 5-Ps field
  (the questions are already asked — now they have somewhere to go);
  clinician sign-off + version bump.
- `plan/accept` persists the full formulation object + concernAreas +
  strengths onto `CarePlan` (today it keeps only the prose string);
  re-acceptance guard: no-op returning the current version when
  `sourceSessionId` already produced a plan; a revisited accepted intake
  renders read-only with "agreed on {date}".
- `buildSessionPrompt` carries a richer formulation block into every
  treatment session (perpetuating factors + strengths, not one line);
  the typeof-string read path is preserved so old rows still render.
- The TREATMENT report schema gains `formulationUpdate` (what shifted,
  field-level) folded back into the case-file read path — the
  formulation accumulates instead of freezing at intake.
- **My Plan page (`/care/plan`)**: formulation in plain words, goals
  with why + measure + status, cadence in plain words, version history
  linked to the report that changed each version; credited-never-
  signatory footer per charter.
- Nav surgery: "Plan" → the therapeutic plan page; billing moves to
  "Membership" under Settings; the suppression predicate is asserted on
  the new route (zero commerce).

**Acceptance.** Round-trip proven (intake → structured fields on
`CarePlan` → visible in the treatment prompt and on My Plan); old
string-formulation rows still render; double-tapping "This is my plan"
does not create version n+1; nav "Plan" opens the therapeutic plan with
CI suppression assertion green; `formulationUpdate` from a treatment
report appears in the next session's prompt; all new copy
clinician-signed; mock fixtures updated.

### CP5 — Manualized protocol arcs, mastery-gated, plus the skills toolkit

**Goal.** Each modality track becomes a real session-by-session
curriculum with an arc, a completion, and a step-down — advanced on
evidence from the structure engine, never on attendance modulo — and the
skills taught get a practice home.

**Builds.**

- Promote `CARE_PROTOCOL_STEPS` to clinician-authored curricula:
  CBT-depression ~12 steps, GAD/worry ~10, behavioural activation ~8,
  CBT-I ~6 — each `{sessionGoal, moves[], skillTaught, doneCriteria,
homeworkTemplate}`; versioned with the prompt.
- A step pointer persisted on `CarePlan` (one guarded migration):
  advances only when `doneCriteria` are met — evidenced by CP2 events
  (`mark_phase` reaching work-complete, `log_moment` SKILL, worksheet
  confirms) + Pass 13 goalProgress; repeats otherwise, capped at 2
  repeats before the prompt adapts; a track switch at review resets to
  step 0 (kills the modulo misindex).
- Arc position rides the live prompt and the CP2 agenda rail ("session
  4 of 12: behavioural experiment").
- Arc completion pulls REVIEW forward regardless of the every-6 counter
  and opens the step-down/graduation branch in the review prompt
  (graduation framed as success, never A/B-tested toward retention).
- **`/care/toolkit`**: skills unlocked so far per track (from
  `skillTaught`) with step-by-step practice cards adapted from the
  `packages/clinical` exercise catalog — clinician-signed copy,
  provenance from live events ("practiced with {persona} on {date}"),
  deep-linked from homework and the worksheet drawer; "bring to session"
  pre-fills the next session's topic.
- Homework upgraded from one string to the structured object end-to-end:
  `assign_homework` events + report homework persist
  title/steps/whyItHelps; the home card renders per-step ticks;
  adherence recorded without streak-breaking language.

**Acceptance.** A vent-the-whole-session treatment session does NOT
advance the step (and two repeats trigger the adaptive branch);
completing the CBT-I arc triggers a review offer regardless of the
every-6 counter; a track switch starts the new curriculum at step 0
(unit test); the toolkit is reachable from nav, homework, and reports
with sign-off metadata on every entry and no commerce; homework steps
individually tickable and exactly matching the `CareLiveEvent` record;
migration idempotent.

### CP6 — Document-grade reports: mastheads, key moments, honesty, an archive

**Goal.** Every session yields a document a psychologist would recognise
— built exclusively from data the engine actually produces
(`CareLiveEvent` moments, worksheets, agreed homework, `endedReason`) —
honest about truncation, browsable forever.

**Builds.**

- A report masthead on every kind: date, duration, session N of arc,
  topic, mood before → after delta, capture status.
- Timestamped key moments: `stitchTranscript` emits `[mm:ss]`
  (`CareTurn.atMs` is already persisted); keyMoments render primarily
  from CP2 `log_moment` events with verbatim quotes (anti-Barnum),
  LLM-selected moments only as fallback; worksheet outputs and
  homework-as-agreed (with the user's ✓/✗) render from `CareLiveEvent`.
  **No field ships that the engine doesn't produce.**
- The Intake Assessment Report restructured section-by-section:
  presenting concerns with quotes → history + strengths → Measures &
  Scores (labeled severity bands) → risk summary in plain words (never
  the raw riskScreen) → 5-Ps formulation → provisional impressions
  (never diagnosis-as-fact) → per-goal agreement cards finally rendering
  why + measure with Accept/Adjust → track + cadence with rationale.
- Real goal text everywhere: the session GET's `currentPlan` select
  extended to include goals; "Goal 1: ▲" bare-index renders killed.
- moodAfter-aware generation: debounce Pass 13 until the mood-after tap
  lands or timeout (the `CareReport` upsert is already idempotent), so
  the delta appears IN the persisted report.
- Honest truncation: sessionStatus + durationSec + CP1's `endedReason`
  passed into `buildCareReportUserMessage`; ABORTED/disconnected/short
  sessions get a "we got cut off — here's what we captured" branch; a
  minimum-content gate below which no plan is proposed and no plan CTA
  renders.
- Degrade visibly, never hollowly: sections render conditionally; a
  `.catch`-degraded section shows "this section could not be written" +
  regenerate, never an empty card. Fix the `CARE_REPORT_PROMPT_VERSION`
  V2/V1 drift while bumping the prompt; slice resonance taps by prompt
  version to gate the change.
- **`/care/reports` archive**: chronological cards (date, kind chip,
  headline, duration, mood delta), truncated sessions marked honestly,
  crisis reports present with compassionate framing. Report-side
  disconnect fix: the poll timeout offers finalize-and-generate instead
  of spinning forever.

**Acceptance.** A sweeper-aborted 4-minute fragment renders as an honest
partial record with no plan CTA; a tooled treatment report shows ≥2
timestamped verbatim key moments, real goal text + measure, the skill
practiced, agreed homework matching the `CareLiveEvent` record, and the
mood delta; old `CareReport` rows render unchanged; report p95 < 90 s
held in canary; every historical report reachable from `/care/reports`;
the poll never dead-ends; prompt-version drift fixed.

### CP7 — Measurement every session: ratings, worsening detection, the case file, review ceremony v2

**Goal.** Something is measured at every contact and the longitudinal
record proves whether the work is working — deterioration caught in days
not at session 6, verdicts in the deterministic engine's honest
vocabulary, graduation gated on an enum.

**Builds.**

- Post-session 2-tap ratings on the report screen: mood-after (exists) +
  per-goal 0-10 (joining in-session `record_goal_rating` events into one
  rated series) + optional SUDS for exposure/grounding sessions.
- Biweekly PHQ-9/GAD-7 nudge via the existing care-nudges cron; zero
  nudges under `SAFETY_HOLD`; the pre-review 72 h check-in kept.
- `worseningVerdict` made real: remove the five hardcoded `false` call
  sites; nadir-aware relapse (best-score delta) + per-plan-version
  baselines in the existing verdict loop.
- Surface the discarded richness: `isResponse` / `isRemission` /
  `percentChange` / severity-band transitions flow into the review
  verdictsLine and `CareProgressReview` plainWords; replace the
  graduation substring match (`'improvement'.includes`) with a typed
  verdict enum flowing change-score → report → billing-stop.
- **Case File (Progress v2)**: an instrument trajectory chart — every
  response, dated, plotted against labeled severity-band lanes, baseline
  - review markers, reliable-change verdicts annotated in the engine's
    exact words; session map cards; a homework adherence strip (warm copy,
    no broken-streak language); journal read-back finally showing check-in
    notes threaded under the reflectionPrompt each answered.
- Review ceremony v2: the score story on the band scale with
  response/remission language, goal outcomes with real text, revised
  goals reusing the per-goal Accept/Adjust cards, three honest
  recommendation branches (CONTINUE / STEP-DOWN graduation ceremony with
  billing-stop stated plainly / HUMAN_THERAPIST with a polished handover
  PDF: masthead + trajectory + plan-version history).

**Acceptance.** 18→8→16 triggers worsening → review pulled forward (unit
test); mood delta + per-goal ratings render in the persisted report and
accumulate in the Case File; reliable-change thresholds untouched
(PHQ-9 5 / GAD-7 4, remission ≤4, response ≥50% — changes need clinician
sign-off + citation); graduation/billing-stop gated on the enum with the
substring test deleted; the trajectory chart labeled and accessible in
light + dark using ONLY deterministic-engine vocabulary; the nudge cron
respects `SAFETY_HOLD` and the suppression predicate.

### CP8 — Prove it on the wire: e2e suite, live-engine observability, doc truth

**Goal.** Everything CP1–CP7 assumed is probe-verified and continuously
tested; failures become measured numbers instead of anecdotes; the docs
stop lying about what exists.

**Builds.**

- A Playwright e2e suite against the mock stack: full arc per kind +
  drop-resume + premature-end decline + tool spam + refresh rejoin +
  truncated-report honesty + coverage-gated intake ending.
- Consolidated probe rituals in `scripts/live-probe` +
  `care-vertex-live-probe`: `tool_response` envelopes (both casings),
  resume-with-handle, `goAway` soak, silent-cue non-verbalization — the
  mandatory pre-canary gate for any model-pin or prompt-version change
  (never both in one deploy).
- Live-engine metering: `endedReason`, reconnectCount, cuesSent,
  toolCalls accepted/rejected, steering-cue counts in the `/end` payload
  - observability counters; an endedReason breakdown makes "what % of
    sessions die disconnected" a tracked number; Sentry breadcrumbs on
    every live state transition.
- Canary discipline: `CARE_LIVE_ENGINE_V2` staged rollout per the
  runbook's model-pin canary pattern; flag-off rollback verified
  byte-identical; alliance-pulse + resonance sliced by prompt version as
  the regression gate.
- Doc truth pass: `AI_COUNSELING.md` status header + realized-resilience
  section with the wire shapes; `CARE_GROWTH_SYSTEM` §11 stale-defect
  refresh; the runbook verification arc updated for
  cues/reconnect/tools; PRODUCTION_READINESS + CHANGELOG entries; the
  mock-server fixture inventory documented.

**Acceptance.** Playwright suite green offline in CI covering all
failure modes; probes green on both backends and documented as the
pre-canary ritual; endedReason distribution visible in metrics within
one deploy; every promise string in the docs maps to a shipped
mechanism; prompt and model-pin changes verifiably in separate deploys;
flag-off re-verified byte-identical.

## 4. The screens (8)

Full visual mockups live in the design artifact ("Cureocity Care —
Proper Psychologist screens"); this is the canonical element list.

1. **Live Session v2** — the room, with the therapist's structure and
   clock made visible: time pill synced to setupComplete (amber in the
   final 5 min, never alarming red), ambient phase dots (arriving ·
   agenda · the work · closing; intake shows 6-domain coverage),
   `LiveAgendaStrip` (agenda, arc position, goals-in-play, open
   homework), the breathing orb + captions (kept), moment toast
   ("✦ noted"), worksheet drawer with "Keep this", homework ✓/✗ card,
   T-2 wind-down banner ("wrapping up together" — context-free
   "Wrapping up…" never appears), confirm-end sheet, amber
   "Reconnecting — nothing is lost" state with the countdown still
   ticking, honest cut-off ending, "Rejoin session" gate on refresh,
   and the crisis button pinned exactly as today — never moved, never
   gated.
2. **Starting Picture** — pre-intake baseline: "Before we talk, a
   starting picture"; PHQ-9 then GAD-7, one item per step, ≤3 min;
   instant gentle result on labeled severity bands; the graded item-9
   branch into the plain-language risk ladder; optional WHO-5; honest
   skip ("your plan will start unmeasured"); SafetyStrip persistent.
3. **Assessment Report Ceremony (intake)** — the document that ends the
   first session: masthead; "Where you're starting" scores on bands;
   presenting concerns with verbatim quotes + resonance check; history +
   strengths; risk summary in plain words; the 5-Ps formulation card
   (staged reveal kept); provisional impressions; per-goal agreement
   cards (goal + WHY + HOW measured, each Accept/Adjust); track +
   cadence with rationale; "This is my plan" ceremony; credited footer
   ("Drafted by {persona}, your AI therapist · Agreed by you, {date}");
   the truncated variant has no plan CTA; zero commerce, CI-asserted.
4. **Session Note v2 (treatment report)** — masthead (session N of arc,
   duration, topic, mood delta, capture status); headline as quoted
   serif h1 (kept); arc timeline strip from persisted phase events; 2-4
   key-moment cards ([mm:ss] + verbatim quote + why it mattered); skill
   card + "what's next in your track"; worksheet output card; goal
   progress with REAL goal text; formulation update; the homework card
   exactly as agreed live with tickable steps + toolkit deep-link;
   post-session 2-tap ratings; reflection prompt + next-week picker
   (kept); honest cut-short banner; degraded sections say "could not be
   written" + regenerate.
5. **Review Ceremony** — the stocktake: masthead (plan version under
   review); the score story baseline → now on the band scale in the
   engine's exact vocabulary; inline trajectory mini-chart; goal
   outcomes (achieved celebrated / keep / revised with Accept/Adjust);
   the recommendation card with three honest branches (CONTINUE /
   STEP-DOWN graduation with billing stop stated plainly /
   HUMAN_THERAPIST with handover PDF); share card only after the
   ceremony, suppression-gated.
6. **My Plan** — the plan's real home, divorced from billing: "Your
   plan · v3, agreed {date}"; 5-Ps formulation prose; goal cards
   (text · why · measure · status · latest rating); the protocol arc
   map (done / current / ahead); cadence in plain words + next review
   marker; concern areas with their original quotes; version history
   accordion linked to the reports that changed each version;
   credited-never-signatory; no commerce (billing → Settings →
   Membership).
7. **Case File** — the longitudinal spine: stage strip (kept); the
   instrument trajectory chart (every response, dated, severity-band
   lanes, baseline + review markers, verdicts in the engine's exact
   words); verdict cards with band transitions ("moderate → mild"); the
   report archive (date · kind chip · headline · duration · mood delta;
   truncated marked honestly; crisis entries with compassionate
   framing); homework adherence strip (warm copy); journal read-back
   (check-in notes threaded under their prompts); per-report + handover
   export; milestone share card at the bottom only.
8. **Skills Toolkit** — what {persona} teaches, available between
   sessions: "From your sessions" row with provenance ("practiced with
   Asha · June 12"); track sections from the `packages/clinical`
   catalog; serif exercise cards with duration chips + second-person
   steps; "This week's practice" badge; "bring to session" pre-fills the
   next topic; clinician-reviewed mark on every entry; crisis strip
   pinned; no commerce.

## 5. Guardrails (non-negotiable, inherited + extended)

1. **Crisis is never gated, monetized, or interrupted.** The crisis
   button/SafetyStrip stays pinned and untouched on every new surface;
   item-9 value 2-3 and ladder plan/intent still hold immediately;
   bridging script verbatim; holds lift only via the resume route; zero
   nudges under `SAFETY_HOLD`; zero commerce on any clinical surface —
   the ONE suppression predicate, CI-asserted.
2. **Clinician sign-off is a merge gate, not a courtesy.** Every prompt
   version, time/steering cue wording, risk-ladder rung, curriculum
   step, severity-band plain-words string, and toolkit entry ships with
   the named advisor's sign-off recorded in the PR; batch sign-off
   packets per sprint (the advisor is the schedule critical path).
3. **Validated instruments only, licensing documented.**
   PHQ-9/GAD-7/WHO-5 verbatim validated wording with provenance; the
   risk ladder is demonstrably original plain language, NOT C-SSRS or a
   paraphrase; ISI never sneaks into the SLEEP track; no machine
   translation of clinical-adjacent copy.
4. **The deterministic engine owns clinical judgment.** Reliable-change
   thresholds untouched without clinician sign-off + citation; "reliable
   change"/"response"/"remission" vocabulary reserved for
   `change-score.ts` — the model explains, never re-judges;
   graduation/billing-stop gated on a typed enum, never a copy string.
5. **Honest AI everywhere.** riskScreen never rendered raw; degraded
   sections say so; truncated sessions get the "we got cut off" branch
   with no plan CTA; provisional impressions never diagnosis-as-fact;
   credited-never-signatory; `log_moment` quotes verbatim-verified
   (anti-Barnum).
6. **Browser-relays-persistence holds.** No long-lived server sockets on
   Vercel — steering rides the existing 3 s turns-mirror response; all
   live state persists via owner-authed, Zod-validated, tenant-filtered
   `apps/web` routes; cue/steering/reconnect text never enters the
   mirrored transcript or Pass 13 input.
7. **Mock parity is an in-sprint deliverable, never a follow-up.** Every
   new frame, tool, phase, and report field lands in `care-mock-live`
   fixtures + the Playwright arc in the same PR; the mock never again
   teaches auto-wrap; the full three-kind arc stays green offline.
8. **Deploy discipline.** Never rotate the model pin and a prompt
   version in the same deploy; every live-wire assumption is
   probe-verified on BOTH backends before `CARE_LIVE_ENGINE_V2` defaults
   on; flag-off remains a byte-identical rollback through CP8.
9. **Repo conventions.** Contracts-first Zod for every new DTO/tool;
   literal writeAudit strings; one idempotent guarded migration per
   sprint; side-effect routes POST-only; hard caps never extended past
   cap+90 s — the report discloses gaps instead.
10. **Economic honesty.** Report p95 < 90 s in canary; usage/COGS banked
    per-connection and summed across reconnects (sendBeacon on tab
    close); endedReason is a tracked metric; the regret test governs
    every new loop.

## 6. Sequencing rationale (why this order)

- **CP1 ships alone and first** because the founder's pain is one
  failure class — sessions ending for non-clinical reasons (model
  guessing time, blind end_session obedience, transport death, refresh
  death, the T-0 hard cut) — and shipping half of it leaves "auto wrap"
  reproducible. The cost of a bigger CP1 is paid by making the wire
  probes an in-sprint acceptance gate and by the `CARE_LIVE_ENGINE_V2`
  flag keeping rollback byte-identical.
- **CP2 is one sprint, not two** (tools, then rail): it is the platform
  — CP3's coverage rail, CP5's mastery gating, CP6's key moments, CP7's
  goal ratings all consume its events. Splitting would ship a tools
  sprint whose events nothing steers.
- **The risk ladder lives inside CP3** (not its own sprint): the graded
  item-9 branch only has meaning once the battery is administered
  pre-intake; both flows share `CareInstrumentForm` and one clinician
  sign-off packet.
- **CP4 precedes CP5** because the step pointer and arc position hang
  off `CarePlan`, and CP4's plan/accept rework creates the object the
  curricula persist into.
- **Reports come AFTER clinical depth** (CP6 follows CP3–CP5) even
  though the report audit found the loudest gaps: a masthead over a thin
  schema is lipstick. Reports must render measured baselines, 5-Ps
  updates, arc positions, and engine events — which exist only after
  CP3–CP5. The one report fix pulled earlier is the disconnect dead-end
  (session-side finalize in CP1; report-side poll rescue in CP6).
- **CP8 dissolves the "hardening sprint" anti-pattern**: contract-risk
  probes are embedded in CP1/CP2 acceptance (they gate everything
  downstream); CP8 keeps only the durable assets — the Playwright suite,
  observability, canary discipline, and the doc-truth pass.
- **Every sprint is independently shippable** and degrades gracefully if
  its successors never ship: CP1 alone kills the founder's pain; CP2's
  tools are strictly additive; CP3–CP7 use backward-safe schemas so old
  rows always render; the flag guards the whole engine.

## 7. What we are explicitly NOT doing

- **No diagnosis.** Provisional impressions in plain words, never
  ICD/DSM codes as fact — unchanged from the charter.
- **No human-in-the-loop live supervision** (a clinician watching
  sessions in real time) — the clinician's role is sign-off on copy,
  thresholds, and curricula, plus reviewing flagged transcripts.
- **No licensed-instrument shortcuts** — no ISI, no C-SSRS paraphrase,
  no machine-translated clinical copy.
- **No session-cap extension** — 30/25/25 minutes stand; structure makes
  the minutes count instead.
- **No engagement-at-all-costs mechanics** — every new loop (toolkit,
  ratings, nudges) passes the regret test; graduation stays a success
  path with billing stop stated plainly.
- **No multi-user/clinic features, no localization** in this series —
  both are separate, signed efforts.
