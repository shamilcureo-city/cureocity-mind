# Therapist Copilot v2 + the Live Therapy Copilot (TSC / TS5)

This document covers the therapist decision-support surface as it stands after
the **TSC** (copilot decision board + v2) and **TS5** (live therapy copilot)
sprints. It's the therapist analogue of the doctor's
[`DOCTOR_SCRIBE_V2_SPRINTS.md`](DOCTOR_SCRIBE_V2_SPRINTS.md): read that for the
doctor live consult; read this for how the therapist vertical reached the same
bar. For the earlier clinical-copilot foundation see
[`CLINICAL_COPILOT.md`](CLINICAL_COPILOT.md); for the measurement-based-care
engine see [`MEASUREMENT_BASED_CARE.md`](MEASUREMENT_BASED_CARE.md).

There are two surfaces:

1. **The decision board** — the after-session review, on the session page's AI
   Copilot → "This session" tab. Where the therapist turns the AI's reading
   into decisions that persist to the client's record.
2. **The live copilot** — a passive rail on the live-scribe screen that shows,
   _during_ the session, what to re-check for safety, what to ask next, and
   which threads went unexplored.

Both are **passive and evidence-bound**: the AI proposes, the therapist
decides, and nothing the AI says is treated as fact until the therapist
accepts it. Safety rules (crisis gating, reliable-change thresholds, the carry
cap) are never loosened — the work made them _reachable, reversible, and
finishable_, not weaker.

---

## 1. The decision board

**Component:** `apps/web/components/app/CopilotDecisionBoard.tsx`
**Mounted by:** `AICopilotTab.tsx` → `SessionSub` (both session kinds).

The board replaced a long scroll of look-alike section cards with a two-lane
layout, doctor-style:

- **Left — "AI suggests"**, five steps in the order a therapist actually works:
  1. **Safety first** — crisis flags with India hotlines; high/critical
     severity **gates** the rest of the page until acknowledged (treatment) /
     until a safety plan is on file (intake).
  2. **Working impression** — the differential as compact, expandable rows
     (ICD code · confidence bar · evidence quotes · "to confirm" list). Tick
     the candidates to own, mark one primary, accept.
  3. **Ask next session** — the assessment engine (§2).
  4. **Suggested plan** (treatment) / **Suggested approaches → plan v1**
     (intake) (§3).
  5. **Lock in a baseline** — PHQ-9 / GAD-7, deep-linked to the Journey page.
  6. **Wrap up** — the checklist + "Finish review" (§3).
- **Right — "Your case record"**, a sticky, green-topped card showing only what
  the therapist has _accepted_: diagnoses, plan version, safety record,
  baselines, and what next session opens with. This is **server truth** — read
  in `SessionSub` and refreshed via `router.refresh()` after every accept.

One trust banner ("Suggestions only — nothing joins the record until you accept
it") replaces the per-card disclaimers; the lane design enforces the same rule
visually.

### Kind-normalisation

The board serves both session kinds from one shell. `SessionSub` passes the
full `ClinicalReport` DTO plus (for intake) the parsed `InitialAssessmentBriefV1`;
`CopilotDecisionBoard` normalises them into one `BoardData` the five steps
render from. INTAKE reads the brief (`workingHypothesis`, `differential`,
`recommendedInstruments`); TREATMENT/REVIEW read the report body
(`diagnosisCandidates`, `treatmentPlan`).

### Generate / poll / retry

Pass 3 runs in `after()` on the generate-note route, so the therapist can land
on the board in `PENDING`. The board polls
`GET /sessions/[id]/clinical-analysis` every 3 s until `COMPLETED`/`FAILED`, and
a `409 NOTE_NOT_USABLE` (Pass 1 produced an unusable transcript) auto-kicks
`generate-note` so one **Retry** click moves the therapist forward instead of
looping — the exact pattern the old `InitialAssessmentTab` used.

---

## 2. The assessment engine (V2.1)

The "ask next" list is **not** a flat dump of questions — it's an engine that
covers the differential systematically and **converges to zero** as the case
resolves.

Each gap (`ClinicalAssessmentGap` in `packages/contracts/src/clinical.ts`) now
carries the **job** it does:

| `purpose`       | What it does                                            | `targets`                           |
| --------------- | ------------------------------------------------------- | ----------------------------------- |
| `safety`        | A risk question to ask first                            | `[]`                                |
| `differentiate` | Tells two-or-more candidates apart                      | the ≥2 ICD codes it decides between |
| `confirm`       | Establishes an unmet criterion of the leading candidate | that one ICD code                   |
| `context`       | Background that shapes formulation / plan               | `[]`                                |

Both fields are **optional-with-default**, so every pre-V2 stored gap still
parses (the UI drops them into an "Open questions" group; a safety-shaped
question is inferred from wording as a fallback).

**Prompt contract** (`CLINICAL_ANALYSIS_SYSTEM_PROMPT_V2` +
`INITIAL_ASSESSMENT_SYSTEM_PROMPT_V2`): Pass 3 is required to produce a
`differentiate` question for **each pair of leading candidates** and `confirm`
questions for the **leader's open criteria**, safety first — and, crucially, to
**NOT re-ask what's already established** in the transcript or the client's
confirmed history. When the differential has resolved to a single confident
candidate, the correct output is an **empty** `assessmentGaps` array. That's the
convergence: the list shrinks session over session, and the board shows
"✓ Assessment complete — resolved to X".

The 8-item cap applies **only to carrying** (keeps the pre-session brief
scannable); the engine itself is uncapped.

**Robustness:** `packages/llm/src/backends/pass3-normalise.ts` maps drifted
`purpose` synonyms (`"differential"` → `"differentiate"`), drops unknown ones,
and filters non-string `targets`, so a model wobble can't sink the whole report
(the same fail-open discipline as the crisis-flag normaliser).

**UI:** the board's step 3 groups gaps by purpose with ICD-pair chips
(`6A70 ↔ 6B43`), risk-first with a `FIRST` badge, and carries ticked questions
into `Client.carriedQuestions` (→ the next pre-session brief, §5).

---

## 3. Own your decisions + wrap-up (V2.2)

Three things the first board couldn't do:

**Change decision.** Every accepted diagnosis (both kinds) and the plan gain a
**"Change decision"** button that reopens the selection **pre-loaded from the
current record**. Re-accepting supersedes the prior rows and keeps full history.
The accept routes already rebuilt the active record on every confirm — the board
just never offered the door.

**Intake plan v1.** An intake report produces no treatment plan, so the
"Suggested approaches" step is now interactive: tick approaches → **"Draft plan
v1"** opens the same `PlanEditor` the treatment brief uses, **seeded** from the
approaches (modality inferred, a phase sequence, one goal per approach + a
measurement goal). Saving creates the first versioned `TreatmentPlan` through
`POST /clinical-reports/[id]/intake-plan` — so a plan exists from the first
session. "Revise plan" re-versions it.

**Wrap up.** A deterministic checklist of the five decisions (safety, diagnosis,
carried questions, plan, baseline) with anything outstanding linked, plus
**"Finish review"** — which stamps `ClinicalReport.reviewedAt`
(`POST /clinical-reports/[id]/finish-review`, audited `COPILOT_REVIEW_FINISHED`).
It is a **checkpoint, not a lock**: decisions stay revisable afterwards, and
re-tapping just refreshes the timestamp.

### Accept routes

| Action                          | Route                                             | Notes                                                             |
| ------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Treatment diagnosis / plan      | `PATCH /clinical-reports/[id]/sections/[section]` | The existing per-section accept/modify/reject (Sprint 13/35/36).  |
| Intake diagnosis                | `POST /clinical-reports/[id]/intake-diagnosis`    | Accept selected differential candidates → `ClientDiagnosis` rows. |
| Intake plan v1                  | `POST /clinical-reports/[id]/intake-plan`         | Mirrors the sections route's plan-confirm write.                  |
| Carry questions to next session | `POST /clients/[id]/carried-questions`            | Wholesale replace `Client.carriedQuestions`.                      |
| Finish review                   | `POST /clinical-reports/[id]/finish-review`       | Stamps `reviewedAt`.                                              |

Every one is tenant-checked, POST-only for side effects, and writes a **literal**
audit action (the audit-coverage chaos test scans for `action: 'X'` literals).

---

## 4. Three sub-tabs (V2.3)

The five altitude tabs collapsed to three that match how a psychologist thinks:

| Tab                | What's in it                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **This session**   | The decision board.                                                                             |
| **Journey**        | One longitudinal page in narrative order (below).                                               |
| **Plan & toolkit** | Conceptual map, diagnosis history, therapy library, workflow (the former "Formulation & Plan"). |

The **Journey** page runs in the order a therapist reasons: **where they are**
(stage + next-best-action) → **is it working** (PHQ-9/GAD-7 trend +
reliable-change verdicts, administer inline) → **the story so far** (case
briefing + consult) → **what next session opens with** (pre-session brief).
Measures stop being a lonely tab — a score only means something next to the
timeline. No engine changed; the Journey / Measures / Briefing composers were
re-homed.

Old sub keys redirect (`measures`/`briefing` → `journey`, `formulation` →
`plan`) via `LEGACY_SUB_MAP` in the session page parser, so old bookmarks and
the journey next-best-action deep links keep working.

---

## 5. Carried questions → the pre-session brief

`Client.carriedQuestions` (`Json?`, `CarriedQuestion[]`) is the bridge between
the board and the next session. When the therapist carries questions in step 3,
they persist on the client; the pre-session-brief route
(`apps/web/app/api/v1/clients/[id]/pre-session-brief/route.ts`) appends them to
the **case digest** string that Pass 5 consumes, so the next session's brief
literally opens with them. The cache key (`lastSessionId`) already handles
staleness — questions ticked during session N feed the brief keyed on N, which
generates fresh for the next visit.

The same carried questions **seed the live copilot** (§6): the live page reads
them and passes them to the gateway as `TherapyLiveContext.carriedQuestions`.

---

## 6. The live therapy copilot (TS5)

The therapist live-scribe screen (already streaming a speaker-true conversation

- an assembling note through the shared gateway, per the B-series) now grows a
  third rail: the passive, citation-gated copilot.

### The pass — `PASS_12_THERAPY_REASONING`

The therapist analogue of the doctor's `PASS_11_REASONING`. One Flash call per
window (asia-south1 for DPDP residency, temperature 0, structured JSON) over the
**new utterances** + a recent tail + the planned questions + a prior-risk flag,
producing three arrays:

- **riskWatch** — safety cues drawn from what the client actually said.
- **askNext** — up to 3 LIVE questions worth asking now (not generic intake
  questions, not a restatement of a planned one).
- **threads** — themes the client raised and moved on from.

Files: contract `packages/contracts/src/live-therapy-reasoning.ts`, prompt
`THERAPY_REASONING_SYSTEM_PROMPT_V1`, backend
`packages/llm/src/backends/vertex-therapy-reasoning.backend.ts`, normaliser
`therapy-reasoning-normalise.ts`, wired through `ModelRouter.passTherapyReasoning`
(mock + Vertex in all three router build sites). `LLM_BACKEND=mock` gives a
keyword-routed offline copilot.

### The gateway loop — `services/live-gateway/src/therapy-reasoning.ts`

`TherapyReasoningStore` is the therapist's CaseState analogue. Where the gateway
used to return early for `vertical === 'THERAPIST'`, `runTherapyReasoning` now
runs the pass per window (and at finalize), and the store maintains a stable,
emitted snapshot:

- **Citation gate** — a LIVE risk/ask/thread survives only if it cites an
  utterance id the gateway has **actually seen**. The hallucination control,
  identical in spirit to the doctor finding gate. CARRIED items and the
  deterministic SI re-check are gateway-seeded and exempt.
- **Stable ids** — items are keyed by a slug of their content, so re-emitting
  the same cue updates it in place instead of flickering a new card. Dismissed
  ids stay dismissed.
- **Deterministic safety** — when prior suicidal ideation is on file
  (`TherapyLiveContext.priorRisk`), a **"Re-check ideation"** risk item is
  always present until dismissed, regardless of what the model returned.
- **CARRIED seeding** — the planned questions become `CARRIED` ask-next items
  (no citation needed).
- **The arc** is computed here from elapsed-vs-planned minutes (opening →
  working → closing → overrun); the model never guesses the clock.
- **Change detection** — a content/phase change key means a bare minute tick
  doesn't spam `therapyReasoning` events; the arc still advances during silence
  (pump recomputes it), emitting only on a phase flip.

`TherapyLiveContext` reaches the gateway on the `start` command (the gateway has
no DB); the browser supplies it from the live page's DB read.

### The rail — `apps/web/components/app/TherapyCopilotRail.tsx`

Renders the snapshot: risk watch (severity-toned; the carried re-check flagged),
ask-next (PLANNED vs LIVE chips), threads (×N mentions), and a session-arc clock
with a progress bar. Every card is one tap — **Asked ✓ / Assessed ✓ / Explore**
or **Skip / Not relevant / Dismiss**. Resolving a card sends the `dismiss`
command to the gateway (so it stops re-suggesting) **and** relays the lifecycle
to the audit trail: `shown` on first appearance, `acted`/`dismissed` on tap,
through `POST /sessions/[id]/live-suggestion` (reusing the DS3
`LIVE_SUGGESTION_*` actions — the pilot dataset grows for free).

---

## 7. Data model additions (TSC / TS5)

| Field / value                           | Where                                        | Why                                                         |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `Client.carriedQuestions: Json?`        | `prisma/schema.prisma`                       | Questions to carry into the next session / seed the copilot |
| `ClinicalReport.reviewedAt: DateTime?`  | `prisma/schema.prisma`                       | Wrap-up "Finish review" checkpoint                          |
| `AuditAction.CARRIED_QUESTIONS_UPDATED` | `prisma` + `packages/contracts/src/audit.ts` | Carry save                                                  |
| `AuditAction.COPILOT_REVIEW_FINISHED`   | `prisma` + `audit.ts`                        | Wrap-up finish                                              |
| `GeminiPass.PASS_12_THERAPY_REASONING`  | `prisma` + `packages/llm` + `observability`  | Live therapy reasoning call-log rows                        |

Migrations (all idempotent per the convention):
`20260816000000_tsc_copilot_decision_board`,
`20260817000000_tsc_v2_wrap_up`,
`20260818000000_ts5_therapy_reasoning_pass`.

---

## 8. Where to look first

| When you want to…                                   | Start here                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Change the decision board                           | `apps/web/components/app/CopilotDecisionBoard.tsx`                                                        |
| Change the assessment-engine prompt                 | `CLINICAL_ANALYSIS` / `INITIAL_ASSESSMENT` prompts + `pass3-normalise.ts`                                 |
| Change a gap's purpose/targets shape                | `ClinicalAssessmentGapSchema` in `packages/contracts/src/clinical.ts`                                     |
| Add / change an accept route                        | `apps/web/app/api/v1/clinical-reports/[id]/*` (sections / intake-diagnosis / intake-plan / finish-review) |
| Change the 3 sub-tabs                               | `apps/web/components/app/AICopilotSubTabs.tsx` + `AICopilotTab.tsx` + the session page parser             |
| Change the merged Journey page                      | `AICopilotTab.tsx` → `JourneySub`                                                                         |
| Change how carried questions reach the brief        | `apps/web/app/api/v1/clients/[id]/pre-session-brief/route.ts`                                             |
| Change the live therapy pass                        | `packages/llm/src/backends/vertex-therapy-reasoning.backend.ts` + `THERAPY_REASONING_SYSTEM_PROMPT_V1`    |
| Change the live copilot merge / citation gate / arc | `services/live-gateway/src/therapy-reasoning.ts` (+ its spec)                                             |
| Change the live copilot rail                        | `apps/web/components/app/TherapyCopilotRail.tsx` + `TherapistLiveSession.tsx`                             |
| Seed the live copilot context                       | `apps/web/app/app/sessions/[id]/live/page.tsx`                                                            |

---

## 9. Gotchas

- **The prompt version const vs string.** `THERAPY_REASONING_SYSTEM_PROMPT_V1`'s
  version string is `THERAPY_REASONING_SYSTEM_PROMPT_V1` (they match here — unlike
  the doctor reasoning pass, whose const is `_V1` but string is `_V2`). Persist
  the string constant, not the name.
- **The gateway has no DB.** The live copilot's carried questions + prior-risk
  flag arrive on the `start` command's `therapyContext`. Never add a DB read to
  the gateway — seed it from the browser.
- **Utterance speaker is `doctor | patient | unknown` across both verticals.**
  In a therapist session the client is `patient` and the therapist is `doctor`.
  Filter on `patient` for client-only cues.
- **A dismissed live suggestion is dismissed for the session.** The gateway
  store keeps the dismissed set; re-applying a pass never resurrects it. The
  deterministic SI re-check is the one item you can dismiss but which is
  otherwise always present.
- **Every new live copilot suggestion still needs its lifecycle audit** via the
  `live-suggestion` route or the audit-coverage chaos test breaks — the
  therapist rail reuses the existing four `LIVE_SUGGESTION_*` writers, so no new
  action was added.
- **Reliable-change thresholds, crisis gating, and the carry cap did not
  change.** If you touch `change-score.ts` you need a clinician sign-off + a
  citation (see `MEASUREMENT_BASED_CARE.md`).
