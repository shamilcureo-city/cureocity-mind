# Therapist Scribe V2 — the revamp sprint plan (TS0–TS5)

**Status:** planned (2026-07-09). The therapist vertical still runs the
original batch architecture while the doctor vertical got three revamp arcs
(DS0–DS11). This plan brings the therapist side to the same bar: **live
scribing, one review surface, evidence-anchored reports** — synthesized from
a three-way code audit (flow complexity, report quality, live-gateway
feasibility) run 2026-07-09.

_Each sprint is self-contained: goal, tasks with file paths, acceptance
criteria. To execute, say "do TS0", "do TS1", … Order is by value: trust
first, then live, then flow, then content._

---

## 0. What the audit found (evidence-grounded)

### Flow — "too complex" confirmed

| #   | Finding                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Scheduled-session dead-end**: booking + recording are disconnected flows on different Session rows. Today's "Start session" opens the workspace (no recorder, `awaiting-end` says "Back to Record"); re-picking in Record mints a NEW session at `now`, orphaning the scheduled row. | `TodaySessionCard.tsx` → `NotesTab.tsx` ~L525-541; `RecordConfirmStrip.start()` posts `scheduledAt: new Date()`; grep: `LiveRecorder` mounted only by `apps/web/app/app/page.tsx` |
| F2  | **Blind batch recording**: during a session the therapist sees Elapsed / Chunks / Pending-upload tiles. No live transcript, no note forming, no copilot.                                                                                                                               | `LiveRecorder.tsx`                                                                                                                                                                |
| F3  | **Three-stage post-hoc wait**: end → upload drain (blocking, "End anyway (note may be incomplete)") → Pass 1+2 (10–30 s, 2 s poll + "Resume generation" stall latch) → Pass 3 (~1 min, different tab, 3 s poll + "Re-run now").                                                        | `LiveRecorder.tsx` L69-96; `NotesTab.tsx` POLL_MS/stall latches; `generate-note/route.ts` `after()`; `ClinicalBriefTab.tsx` poll loop                                             |
| F4  | **Surface sprawl**: 9 primary nav destinations (doctor: 4), 3 competing homes (Dashboard/Today/Record), and a session workspace of ~9 content surfaces (5 tabs + 5 AI-copilot sub-tabs), note editing split across Edit / ModifyPanel / Template / Translate / Verbosity.              | `Sidebar.tsx` PRIMARY; `SessionWorkspaceTabs.tsx` + `AICopilotSubTabs.tsx`; `NotesTab.tsx` (~1,400 lines)                                                                         |
| F5  | **Upfront decision load**: every capture starts with a form (method radio, consent checkboxes, modality/language disclosure) + a context fetch + 3 sequential POSTs (create → consent → start). Doctor: a 3-second flash that auto-starts the mic.                                     | `RecordConfirmStrip.tsx` L151-279                                                                                                                                                 |
| F6  | **Sign bug**: `NotesTab.triggerSignOff` never collects a WebAuthn assertion — an account WITH a registered passkey 401s on sign (`sign/route.ts` requires it when credentials exist).                                                                                                  | `NotesTab.tsx` sign payload has no `assertion`                                                                                                                                    |

### Reports — "not so good" confirmed

| #   | Finding                                                                                                                                                                                                                                                                                                             | Evidence                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| R1  | **Pass-3 diagnosis evidence is never verified**. The prompt demands verbatim quotes; nothing checks them against the transcript. A hallucinated quote flows into `ClientDiagnosis.supportingEvidence` — the permanent record. The doctor side already has the fix pattern (citation gate, `case-state.ts:122-218`). | `vertex-clinical.backend.ts:112` runs only crisis-enum normalisation                         |
| R2  | **The SOAP/intake note has zero transcript provenance** — no evidence field, no confidence. The medical note has `linkedEvidence: EvidenceRef[]` + a hallucination-guarded exam + typed vitals.                                                                                                                     | `note.ts:65-122` vs `medical-note.ts:74-75`                                                  |
| R3  | **All nine therapist prompts are literal PLACEHOLDERs** ("pending Sharafath sign-off"); the SOAP prompt (~27 lines) is less demanding than the medical-note prompt (~35 lines, evidence required).                                                                                                                  | `prompts/index.ts:330-357` + PLACEHOLDER footers                                             |
| R4  | **Evidence timestamps render as dead text** — the contract promises click-through to the transcript moment (`clinical.ts:34-39`); the UI never wired it.                                                                                                                                                            | `ClinicalBriefTab.tsx:414-416`                                                               |
| R5  | **Deterministic outputs under-written**: letters are boilerplate paragraph-fills; case-file per-session "summaries" are 160-char plan slices; the (good) Progress Report covers only PHQ-9/GAD-7 with ≥2 administrations.                                                                                           | `letter-templates.ts:51-113`; `case-file/pdf/route.ts:208-215`; `progress-report.ts:108-111` |
| R6  | **Version-string drift**: `THERAPY_SCRIPT_PROMPT_VERSION` says `_V2` while the const is `_V1` (same for reasoning) — the GeminiCallLog audit trail lies.                                                                                                                                                            | `prompts/index.ts:611,307`                                                                   |

### Live-scribe feasibility — cheaper than expected

- **Reusable as-is**: `server.ts`, `vad.ts`, `meter.ts`, `auth.ts`, `pool.ts`,
  the `reasoning-loop.ts` scheduler, the Pass-1 transcript rail, and the
  browser audio path (`use-live-stream.ts` uses the SAME worklet + decimator
  as the batch recorder).
- **Already therapy-capable**: Pass 2 (`Pass2Input` takes
  `{kind, modality, vertical}`; the therapy prompt + mock arm exist); the
  interim-note trick is just Pass 2 re-run on the growing transcript —
  nothing medical about it. `NoteDraft.content` already unions
  `TherapyNoteV1`. `live-token` is NOT vertical-gated and its consent
  snapshot covers the exact therapist scopes.
- **Needs branching**: three `vertical:'DOCTOR'` hardcodes in
  `live-session.ts`; the `note`/`final` wire events are typed
  `MedicalEncounterNoteV1.partial()`; the `live-note`/`live-metric`/
  `live-suggestion` routes 409 on non-doctors; `live-note` runs medical-only
  side-effects (`persistDraftedOrders`, `persistVitalReadings`).
- **Medical-only, gate off for therapy**: `rx-pad.ts`, drug interactions,
  the differential/`PASS_11_REASONING`, ask-next templates, the cardiac
  red-flag table (keep the self-harm rule).
- **Genuinely new**: the therapist live UI surface, and (later) a therapy
  reasoning pass.
- **Key gotchas**: therapy Pass 2 REQUIRES `kind`/`modality` → they must ride
  the gateway `start` command; INTAKE produces `IntakeNoteV1` (different
  shape) — MVP can scope to TREATMENT/REVIEW; 50-min sessions need the
  interim-note debounce re-tuned (`LIVE_NOTE_REFRESH_MS`); `Utterance.speaker`
  is `doctor|patient` (cosmetic relabel).

---

## TS0 — Trust the reports (evidence gate + provenance + sign fix)

**Goal:** make every AI claim verifiable before touching the UX. Highest
clinical impact, zero flow disruption. This is the therapist port of the
doctor's citation-gate philosophy.

**Tasks**

1. **Pass-3 evidence gate.** New `verifyPass3Evidence(report, transcript,
speakerSegments)` in `packages/llm/src/backends/pass3-normalise.ts` (or a
   sibling module): every `supportingEvidence.quote` must fuzzy-match
   (normalised whitespace/case, ≥90% containment) a real transcript span;
   unverifiable quotes are dropped, a candidate losing ALL evidence is
   dropped, and the report gains `evidenceVerification: {checked, dropped}`
   metadata. Wire into `vertex-clinical.backend.ts` after
   `normalisePass3Output`. Mirror `case-state.ts:122-218` semantics. Same
   gate for `InitialAssessmentBriefV1`.
2. **Note provenance.** Add optional `linkedEvidence: EvidenceRef[]` (reuse
   `EvidenceRefSchema` from `medical-note.ts` — move it to a shared module in
   `packages/contracts/src`) to `TherapyNoteV1Schema` + `IntakeNoteV1Schema`.
   Upgrade `THERAPY_NOTE_SYSTEM_PROMPT_V1` + intake prompt to the medical
   prompt's evidence bar (ask for linkedEvidence tying key statements to the
   transcript). Bump prompt version strings honestly.
3. **Clickable evidence.** In `ClinicalBriefTab.tsx` (+ crisis banner +
   `NotePreview`), render each quote's timestamp as a link that switches to
   the Transcript tab and scrolls/highlights the matching segment (the
   doctor's `highlightUtterances` pattern in `DoctorLiveEncounter.tsx`).
4. **Fix the sign bug (F6).** `NotesTab.triggerSignOff` must fetch
   `webauthn-credentials`, and when ≥1 exists run the assertion ceremony
   (borrow the doctor `ReviewAndSign.tsx` sign path) before POSTing.
5. **Fix version drift (R6).** Rename the two `_V1` constants (or the
   version strings) so const name == persisted string.

**Accept:** a fabricated quote injected into a mock Pass-3 response never
reaches the UI (unit test); every rendered quote click-scrolls to its
transcript moment; sign works with and without a registered passkey; nx
typecheck + tests green.

## TS1 — Gateway therapy branch (live pipeline MVP, server side)

**Goal:** the live gateway serves therapist sessions: live transcript +
live-building SOAP note + live risk flags. No differential, no Rx.

**Tasks**

1. **Command + threading.** Add `vertical`, `kind`, `modality` to
   `LiveGatewayCommandSchema` (`packages/contracts/src/live-encounter.ts`);
   thread into `LiveSession` (constructor param). Replace the two Pass-1
   `vertical:'DOCTOR'` hardcodes (`live-session.ts` ~L276, ~L648) and the
   `runNote()` triplet (~L505-518) with the threaded values.
2. **Note rail branch.** `runNote()` reads the `therapyNote` /
   `intakeNote` output arms when `vertical==='THERAPIST'`; emit a therapy
   `note` event. Make the wire `note`/`final` payloads a discriminated union
   (medical partial | therapy partial | intake partial) in
   `live-encounter.ts`. MVP may scope INTAKE to "final-only" (no interim) if
   the partial-intake shape is awkward.
3. **Gate the medical rails.** `runReasoning`, `rx-pad`, drug-interaction
   checks, specialty templates run only when `vertical==='DOCTOR'`. Split
   `gaps.ts` red-flag tables: keep + extend the psych rules (self-harm,
   suicidal ideation, harm-to-others, abuse disclosure — Hindi/Manglish cues
   included) for therapy; cardiac table stays doctor-only.
4. **Free safety rail.** Emit each interim note's
   `TherapyNoteV1.riskFlags` as a live `gap`-style event (severity +
   indicators) so the UI can show a risk banner with zero new LLM passes.
5. **Routes.** Relax the `vertical !== 'DOCTOR'` 409s in `live-note` /
   `live-metric` / `live-suggestion` to accept both verticals; `live-note`
   accepts the note union and skips `persistDraftedOrders` /
   `persistVitalReadings` for therapy; `live-token` accepts (and validates)
   `kind`/`modality` passthrough and skips the active-meds fetch for
   therapists.
6. **Tuning.** Session-length-aware defaults: for THERAPIST raise the
   interim-note debounce (e.g. `LIVE_NOTE_REFRESH_MS` 40 s → 90 s) and keep
   Flash-interim/Pro-finalize. Meter unchanged (`LiveConsultMetric` is
   generic).

**Accept:** with `LLM_BACKEND=mock`, a scripted therapist WS session yields
interim therapy notes + a final `TherapyNoteV1` persisted via `live-note`
(NoteDraft COMPLETED, session COMPLETED); the doctor path is regression-free
(existing gateway specs green + one new therapist-session spec); cost meter
records the consult.

## TS2 — Therapist live UI (one surface, mirrors the doctor consult)

**Goal:** the therapist sees the session happen: live transcript + the note
writing itself + a risk banner, then reviews + signs + shares on the SAME
surface. This is the DS4 + DS11.2 moment for therapy.

**Tasks**

1. **`TherapistLiveSession.tsx`** (new, `apps/web/components/app/`):
   borrow the scaffolding from `DoctorLiveEncounter.tsx` (WS connect,
   live-token mint, `useLiveStream`, phase machine, meter/suggestion relay,
   finalize timeout) — render Transcript panel + building-note panel + a
   risk/safety banner rail (from TS1's riskFlags events). Therapist labels
   (`therapist`/`client`). No Rx pad, no differential.
2. **Session flash.** Reuse `LiveEncounterFlow`/`ContextFlash` structure:
   a 3-second flash showing the pre-session brief essentials
   (`PreparePanel`'s data — last-session recap, today's focus, carryover
   crisis, instruments due) then auto-start. Kind/modality chips shown on
   the flash, editable in one tap (defaults from the
   `session-defaults` cascade — the flash replaces the `RecordConfirmStrip`
   form; consent is snapshotted by `live-token` exactly as the doctor path).
3. **Review & sign on the same surface.** On end, the existing
   review pattern renders inline (note + readiness + sign + `ShareModal`
   trigger) — the therapist never routes to the workspace tab-maze for the
   happy path. (The workspace remains for deep work: clinical brief,
   journey, measures.)
4. **Route + entry.** New page under the session tree (e.g.
   `apps/web/app/app/sessions/[id]/live/page.tsx`,
   `requireOnboardedTherapist`) + `RecordingShell`'s primary intent mounts
   the live flow (batch recorder stays as fallback — the therapist
   `CaptureMode` story mirrors DS11.7: LIVE default, batch = DICTATE/UPLOAD
   analogue). Set `Session.captureMode` accordingly.
5. **Gateway preflight + degrade** (DS11.4 pattern): `live/health` check on
   the flash; if the gateway is down/at capacity, fall back to the batch
   recorder with honest copy.

**Accept:** mock-backend E2E: pick client → flash (3 s) → talk → live
transcript + note visibly build → end → review + sign + share without
leaving the surface; batch fallback works when the gateway is stopped;
screenshot recorded.

## TS3 — Flow collapse (the DS11 analogue for therapy)

**Goal:** kill the dead-end, the triple-home, and the tab sprawl.

**Tasks**

1. **Fix F1 — scheduled sessions start their OWN recording.** Today's
   "Start session" routes to the live page for THAT session row
   (`/app/sessions/[id]/live`); `RecordConfirmStrip`/Record-home picks reuse
   an existing SCHEDULED session for that client today instead of minting a
   duplicate (match by `clientId` + IST-day, mirroring the doctor queue's
   session reuse).
2. **One home.** Merge Record into Today: Today becomes the therapist home
   (`/app` renders it), with the walk-in client picker as a card on it.
   Dashboard content (triage/metrics) folds into Today or moves under My
   Practice. Sidebar PRIMARY trims from 9 to ~5-6 (Today · Clients ·
   Search? · Templates+Assistant under one "Tools"? · My practice · Learn).
   Exact grouping decided in-sprint with screenshots.
3. **Workspace diet.** Post-TS2 the happy path never needs the workspace,
   so: collapse the AI-copilot 5 sub-tabs into a single scrollable Copilot
   tab with section anchors (This session / Journey / Measures / Formulation
   / Case briefing), and consolidate note editing (ModifyPanel absorbs
   Template/Translate/Verbosity as chips). Target: 5 tabs + 5 sub-tabs →
   4 tabs, one editing surface.
4. **Share last-mile.** Keep the translation-preview gate (it's a safety
   feature) but move it inline into the send button flow (single modal
   step with the preview expanding in place).

**Accept:** scheduled → recorded is one click with no duplicate session
(regression test on session-create reuse); nav has ≤6 primary items; the
session workspace has ≤4 top-level tabs; existing E2E flows green.

**Status (TS3):**

- **Task 1 (F1) — DONE.** Today's "Start session" / "Resume" open the live
  scribe for the booked row (`/app/sessions/[id]/live`); the Record home's
  in-person live capture routes there too (virtual / dictation / upload stay
  on the batch recorder — the live stream is mic-only for now). Session-create
  takes `startNow` and reuses today's open session for the client via the pure,
  unit-tested `selectReusableSession` helper (8 regression tests) — no duplicate
  row, no trial credit consumed on reuse.
- **Task 2 (nav) — PARTIAL.** Sidebar primary trimmed 9 → 6 (Today · Record ·
  Clients · Search · Templates · Learn) with a muted **More** group (Dashboard ·
  Assistant · My practice) so nothing is orphaned; mobile bar mirrors the top 5.
  The deeper **page** merge (Today absorbs the Record walk-in picker + Dashboard
  triage; `/app` renders Today) is DEFERRED to a screenshot-driven pass — it
  reshapes shared landing pages that need the therapist's eye to validate.
- **Task 3 (workspace diet) — DEFERRED.** Collapsing the 5 copilot sub-tabs to
  one scrollable tab + merging note-editing surfaces is a visual refactor best
  done with screenshots; not attempted blind.
- **Task 4 (share last-mile) — DEFERRED** to the same screenshot pass.

## TS4 — Report content quality

**Goal:** the outputs read like a good clinician wrote them.

**Tasks**

1. **Prompt uplift.** Bring all therapist prompts to the doctor bar —
   SOAP/intake prompts demand linkedEvidence (TS0), structure
   `modalitySpecific` per modality (typed schemas for CBT thought-record /
   EMDR SUDS at minimum, replacing `z.record(z.unknown())`), and add
   confidence self-flagging on uncertain lines. Where verbatim clinical
   wording needs sign-off (the PLACEHOLDER footers), write the best draft
   now and mark the sign-off as a tracked TODO — don't block the sprint on
   it.
2. **Letters with clinical substance.** `composeLetter` gains a
   case-specific clinical-reasoning paragraph (deterministic from confirmed
   diagnosis + plan + instrument trajectory; optionally a small LLM pass
   later). Referral letters state reason-for-referral from the actual case.
3. **Real case-file session summaries.** Use the note's `summary` field
   (Pass 2 already produces one) instead of the 160-char plan slice; where
   absent, generate once and persist.
4. **Progress report scope.** Render for ≥1 administration (baseline-only
   copy: "where you started"), include all registry instruments (not just
   PHQ-9/GAD-7), and add a deterministic "what we worked on" paragraph from
   session topics + goals.

**Accept:** golden-file snapshot tests for letters/case-file/progress
report; a clinician-readable diff of before/after outputs attached to the
PR; prompt versions bumped + logged.

## TS5 — Live therapy copilot rail (the ambitious one — separate, optional)

**Goal:** the therapy analogue of the doctor's reasoning engine — but
therapy-shaped: not a differential, a **session-awareness rail**.

Scope (new `PASS_12_THERAPY_REASONING`, citation-gated like PASS_11):

- **Themes emerging** this session (with utterance citations).
- **Risk watch** — escalation of the TS1 riskFlags into a proper live pass
  (kind + severity + recommendedAction + hotline surface from
  `packages/clinical/src/crisis.ts`), with the hard-interrupt crisis banner
  the batch path already has.
- **Technique tracker** — interventions used vs the plan's intended
  modality work (feeds the competency dashboard).
- **"Threads not yet followed"** — the ask-next analogue (client mentioned
  X, not explored), capped at 3, dismissible, audited via the existing
  `live-suggestion` route.

Build = new contract (`live-therapy-reasoning.ts`) + prompt + vertex/mock
backends + ModelRouter + `GeminiPass` enum + a therapist `CaseState` variant
reusing the citation gate + the rail UI in `TherapistLiveSession`. Gate
behind an env flag for the pilot. **Do not start until TS0–TS3 are live and
a therapist has used the live scribe on real sessions** — the rail's shape
should be informed by actual usage (the doctor's rail went through DS2→DS3→
DS11.6 iterations for the same reason).

---

## Sequencing + sizing

| Sprint | Theme                                 | Size | Depends on              |
| ------ | ------------------------------------- | ---- | ----------------------- |
| TS0    | Evidence gate + provenance + sign fix | M    | —                       |
| TS1    | Gateway therapy branch                | M    | — (parallel with TS0)   |
| TS2    | Therapist live UI                     | L    | TS1                     |
| TS3    | Flow collapse                         | M-L  | TS2 (happy path exists) |
| TS4    | Report content                        | M    | TS0 (evidence plumbing) |
| TS5    | Live therapy rail                     | L    | TS2 + real usage        |

TS0 and TS1 can run in parallel; TS4 can interleave after TS0. The
recommended cut for "the therapist vertical feels as good as the doctor
vertical": **TS0 → TS1 → TS2 → TS3** (TS4 polishes content, TS5 is the
differentiator once the foundation is live).

Non-goals of this plan: multilingual progress-report copy (needs validated
translations), clinic/multi-tenant, and anything on the CLAUDE.md §11
operational backlog.
