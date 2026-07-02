# Doctor Scribe V2 — the full sprint plan (DS0–DS9)

_The execution companion to [`DOCTOR_SCRIBE_V2_PLAN.md`](DOCTOR_SCRIBE_V2_PLAN.md)
and the approved 11-screen flow. **The centerpiece is the Live Clinical
Reasoning Engine — a live, evolving differential diagnosis and
"questions you haven't asked yet," updating as the doctor talks.**
Everything else (Rx pad, queue, gate) supports that core._

_Each sprint below is self-contained: goal, tasks with file paths,
contracts, prompts, acceptance criteria, and tests. To execute, say
"do DS0", "do DS1", … No further context should be needed._

---

## 0. Global rules (apply to every sprint — re-read before each)

### 0.1 Safety invariants (never violated, any sprint)

1. **Nothing auto-applies.** Every AI suggestion — a dx, a question, a
   drug, an order — requires an explicit doctor tap before it enters
   the Rx/note. (Regulatory posture: "documentation aid + reference
   information"; the clinician confirms all clinical content.)
2. **Citation-gated reasoning.** Every differential item and every
   suggested question must reference the specific extracted findings
   (by id) that justify it. Items citing findings that don't exist are
   **dropped before render**, not shown. This is the hallucination
   control.
3. **Passive by default.** Live suggestions render in the Copilot rail
   only. The single interruptive moment is the before-you-close gate,
   and only for unacted `critical` items.
4. **Zod-validate every event** on both sides of the socket; unparsed
   payloads are logged + dropped, never rendered.
5. **Audit everything**: every suggestion shown, and every doctor
   action on it (accept / dismiss / auto-resolve / expire), with
   timestamps — this is both the safety trail and the pilot dataset.

### 0.2 Model routing (fixed unless a benchmark says otherwise)

| Job                                                            | Model class                           | Cadence                                  |
| -------------------------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| Window transcription (Pass 1)                                  | Flash, asia-south1                    | per 15–30 s audio window                 |
| Findings + differential + ask-next (the **reasoning pass**)    | Flash, structured output, temp 0      | utterance-triggered, debounced (see DS2) |
| Final Rx pad + SOAP + ICD codes                                | Pro, once                             | at "End consult"                         |
| Interactions / trends / template completeness / voice commands | deterministic (`@cureocity/clinical`) | on every transcript delta                |

### 0.3 Budgets (regression-tested from DS0 onward)

| Metric                                     | Budget                            |
| ------------------------------------------ | --------------------------------- |
| Transcript visible                         | ≤ 2 s from speech                 |
| Deterministic nudge                        | ≤ 2.5 s from triggering utterance |
| Reasoning update (differential / ask-next) | ≤ 8 s from triggering utterance   |
| Final Rx + note after End                  | ≤ 15 s                            |
| LLM cost per 5-min consult                 | ≤ ₹2 target, ₹3 hard ceiling      |
| Gateway concurrent sessions per node       | ≥ 50                              |

### 0.4 Definition of done (every sprint)

- Contracts in `packages/contracts` with unit tests; chaos test green.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `format:check` all green.
- Mock backend path works end-to-end (`LLM_BACKEND=mock`) — every
  feature must be demoable with no GCP creds.
- New audit actions wired per CLAUDE.md §6.
- A demo script section executed and screenshotted.

---

## 1. The core concept: CaseState + the reasoning loop

The engine that produces live differential + missing questions is a
**stateful loop** in the live gateway, per consult:

```
                       ┌───────────────────────────────────────────┐
 mic PCM ──▶ VAD ──▶ window ASR (Flash) ──▶ transcript deltas      │
                       │                                           │
                       ▼                                           │
              ┌─────────────────┐   deterministic engines          │
              │    CaseState    │◀── interactions/trends/template ──┤
              │  (per consult)  │                                  │
              │ - patient ctx   │   REASONING PASS (Flash, temp 0) │
              │ - findings[]    │◀── in:  CaseState + new delta    │
              │ - differential[]│    out: findings δ, differential,│
              │ - askNext[]     │         askNext, answered ids,   │
              │ - asked/answered│         urgency flags            │
              │ - rx draft      │                                  │
              └────────┬────────┘                                  │
                       ▼                                           │
        ranked Copilot feed events ──▶ browser (rail + Rx pad) ────┘
```

Key properties:

- **Incremental**: the reasoning pass sees the case state + the NEW
  transcript delta — never re-reads the whole consult (cost + latency).
- **Stable identities**: findings and dx items carry ids the model is
  instructed to preserve across updates, so the UI animates rank
  changes instead of flickering a new list.
- **Self-resolving**: when the findings extractor detects a suggested
  question was asked/answered, the ask-next card auto-resolves ✓ —
  the rail cleans itself up as the doctor works.

---

## DS0 — Foundations: incremental pipeline + metering

**Goal**: replace the O(n²) rolling-buffer re-transcription with
incremental windows; instrument latency + cost per consult. Nothing
user-visible changes yet — this makes everything after it possible
and affordable.

**Why**: today `live-session.ts` re-runs Pass 1 + Pass 2 on the ENTIRE
buffer every 4 s — cost grows quadratically with consult length and
latency degrades. The therapist Sprint-57 "transcribe-on-arrival"
pattern is the proven fix, applied live.

**Build**:

1. `services/live-gateway/src/vad.ts` — energy-based VAD + silence
   trimming on incoming PCM (OPD audio is heavily silent). Unit-test
   with synthetic frames.
2. Rework `services/live-gateway/src/live-session.ts`:
   - Segment audio into ~15–30 s windows at silence boundaries.
   - Pass 1 ONLY on each new window; append to a running transcript
     with utterance records `{ id, speaker, text, tStart, tEnd }`.
   - Delete the whole-buffer re-run. Keep the final full-quality pass
     at End (existing behaviour) as fallback assembly.
3. `services/live-gateway/src/meter.ts` — per-consult meter: input/
   output tokens per model call, model, latency; running ₹ estimate.
   Emit a `meter` event (dev-only display) + persist a summary row at
   consult end (`LiveConsultMetric` table + migration, idempotent DDL).
4. Contracts: `UtteranceSchema`, `MeterSummarySchema` in
   `packages/contracts/src/live-encounter.ts` (additive; bump nothing).
5. Latency instrumentation: stamp `tAudio → tTranscriptEvent` per
   window; log p50/p95 at consult end.

**Accept**: 10-minute synthetic consult costs O(n) not O(n²) (assert:
last-window token count ≈ first-window, ±20%); transcript p95 ≤ 2 s on
mock; meter row written; all suites green.

**Tests**: unit (vad, windowing, meter math); integration: scripted
PCM stream through gateway on mock → assert utterance stream + meter.

---

## DS1 — CaseState + findings extraction (the reasoning substrate)

**Goal**: a per-consult `CaseState` and a Flash micro-pass that turns
transcript deltas into **structured clinical findings** — the atoms
the differential and ask-next engines cite.

**Build**:

1. Contracts (`packages/contracts/src/case-state.ts`):
   ```ts
   ClinicalFindingSchema = {
     id,                    // stable, model-assigned (f1, f2, …)
     kind: 'symptom'|'sign'|'vital'|'history'|'negative'|'medication'|'social',
     label,                 // "exertional chest pressure"
     detail?,               // "×2 days, relieved by rest"
     utteranceIds: string[],// citation into the transcript
     polarity: 'present'|'denied'|'unknown',
   }
   CaseStateSchema = {
     patient: { age?, sex?, knownConditions[], activeMeds[], allergies[] },  // from DB at start
     findings: ClinicalFinding[],
     answeredQuestionIds: string[],
     version: number,
   }
   ```
2. `services/live-gateway/src/case-state.ts` — holds state; merge
   logic (new findings append; same-id updates replace; negatives can
   flip polarity); seeds `patient` from a `context` field on the
   `start` command (browser fetches it from the encounter page data).
3. `packages/llm/src/backends/vertex-findings.backend.ts` (+ mock):
   **PassFindings** — input `{ caseState, newUtterances }`, output
   `{ findings: δ, answeredQuestionIds }`. Structured output, temp 0.
   Prompt rules: extract only what was actually said; every finding
   must cite utterance ids; never infer diagnoses here. Follow
   CLAUDE.md §5 for the new-pass checklist (router, mock, metrics
   union, GeminiPass enum migration).
4. Wire into the DS0 loop: run after each new window's utterances land
   (debounced — see DS2 scheduler; share the same trigger).
5. Emit `finding` events; extend `LiveGatewayEventSchema` additively.

**Accept**: golden-transcript test — feed the scripted cardio consult
(mock returns canned deltas) → CaseState converges to expected
findings incl. one `negative`; every finding cites real utterance ids
(gate drops fabrications — test with a poisoned mock).

---

## DS2 — Live differential engine (THE core)

**Goal**: a ranked, evolving differential diagnosis with cited
evidence for/against each candidate — updating within ≤8 s of new
clinical information.

**Build**:

1. Contracts (`packages/contracts/src/live-reasoning.ts`):
   ```ts
   LiveDifferentialItemSchema = {
     id,                          // stable across updates (d1, d2…)
     label,                       // "Unstable angina"
     icd10?,                      // "I20.0"
     likelihood: 'high'|'moderate'|'low',
     trend: 'new'|'up'|'down'|'steady',
     urgent: boolean,             // time-critical if true
     evidenceFor: string[],       // finding ids — REQUIRED, ≥1
     evidenceAgainst: string[],   // finding ids
     discriminator?: string,      // what would most change this ranking
   }
   LiveReasoningSchema = {
     differential: LiveDifferentialItem[],   // max 5
     askNext: AskNextItem[],                 // see DS3
     redFlags: { label, why, findingIds[] }[],
     version,
   }
   ```
2. **PassReasoning** backend (`vertex-reasoning.backend.ts` + mock):
   ONE combined Flash call producing findings-δ + differential +
   askNext + redFlags (merging DS1's pass into it — one call per
   cycle, cheaper and coherent; DS1's PassFindings becomes the first
   section of this pass). Input: `caseState + previous differential +
new utterances`. Temp 0, structured output.
   Prompt laws (enforced in the prompt AND post-validated in code):
   - Preserve item ids from the previous differential; adjust
     `likelihood`/`trend` rather than re-creating.
   - Max 5 dx; every dx cites ≥1 real finding id (post-validator drops
     violations + logs `reasoning_citation_dropped`).
   - `urgent: true` only for time-critical dx (ACS, GI bleed, sepsis…).
   - Never output treatment instructions here (that's the doctor's Rx).
3. **Scheduler** (`services/live-gateway/src/reasoning-loop.ts`):
   trigger when (≥1 new final utterance) AND (≥4 s since last pass),
   OR forced at 20 s if deltas pending; skip when nothing new; drop
   superseded in-flight results (monotonic `version`).
4. Normaliser à la `pass3-normalise.ts` for enum drift (likelihood
   synonyms etc.); unknown values still fail (clinical safety).
5. Emit `reasoning` events carrying the full `LiveReasoning` snapshot
   (idempotent client render — no diffing bugs).
6. **Golden eval set** (`packages/llm/src/evals/reasoning/`): 12
   scripted consults (4 cardio, 4 endo, 4 GP; EN + Hinglish + Manglish
   mixes) with expected top-3 dx + expected must-ask questions.
   `pnpm eval:reasoning` scores top-3 recall + citation validity —
   run against the REAL backend in CI-manual mode; mock keeps unit
   determinism. **This is the regression harness for every future
   prompt change — prompts never change without the eval run.**

**Accept**: on the golden set (real backend): expected dx in top-3 for
≥10/12 cases; zero uncited dx rendered; p95 reasoning latency ≤ 8 s on
a live mic test; cost/consult within §0.3 budget (meter proves it).

---

## DS3 — "Ask next" engine (missing questions)

**Goal**: the two-source missing-questions stream, ranked by clinical
value, that cleans up after itself.

**Build**:

1. Contract (in `live-reasoning.ts`):
   ```ts
   AskNextItemSchema = {
     id,
     question,                    // verbatim, ask-able: "Does the pain radiate to the arm or jaw?"
     why,                         // "distinguishes ACS from GERD"
     targetDxIds: string[],       // which differential items it discriminates (may be empty for TEMPLATE)
     source: 'DIFFERENTIAL'|'TEMPLATE',
     priority: 'high'|'normal',
     status: 'open'|'answered'|'dismissed'|'expired',
   }
   ```
2. Differential-driven questions come from the DS2 reasoning pass
   (max 3 open at once — alert-fatigue rule; the model is told the
   currently-open ones so it doesn't repeat).
3. Template-driven: adapt `missingTemplateElements()`
   (`packages/clinical/src/specialty-templates.ts`) to emit
   `AskNextItem{source:'TEMPLATE', priority:'normal'}` — deterministic,
   instant, deduped against differential-driven ones by fuzzy label.
4. **Auto-resolution**: the reasoning pass returns
   `answeredQuestionIds` (it sees open questions + new utterances);
   the gateway flips status → `answered` and the card animates to a ✓
   before collapsing. Dismissals persist for the consult (never
   re-suggest a dismissed question).
5. Priority interleave in the feed: `urgent dx`/red flag > interaction
   > high-priority ask-next > differential movement > template
   > ask-next > coding/trend.
6. New audit actions: `LIVE_SUGGESTION_SHOWN`, `LIVE_SUGGESTION_ACTED`,
   `LIVE_SUGGESTION_DISMISSED`, `LIVE_SUGGESTION_AUTORESOLVED`
   (contracts + prisma enum + migration + writers per CLAUDE.md §6).

**Accept**: golden consults show expected must-ask questions
(≥80% hit); asking one on-mic auto-resolves its card within one
reasoning cycle; never >3 open differential-driven questions; every
show/act/dismiss lands one audit row.

---

## DS4 — The live UI: differential panel + ask-next strip + unified feed

**Goal**: build the approved screens 03–07 for real, upgraded around
the reasoning engine. This replaces the card-only rail with a
**persistent clinical picture**.

**Build** (all in `apps/web`, presentation only — wiring exists):

1. Rework `components/app/DoctorLiveEncounter.tsx` right rail into
   three stacked zones:
   - **ASK NEXT** (top, pinned): up to 3 question chips — question +
     one-line why + target dx tag; states open → answered ✓ (auto) →
     collapse. Tap = mark asked manually.
   - **DIFFERENTIAL** (middle, persistent panel — not cards): ranked
     list, likelihood bar, trend arrow (↑↓→ vs last update), urgent
     marker, expandable evidence chips (render the cited findings'
     labels; tap a chip → highlights the source utterance in the
     transcript pane — the trust feature). "Add to assessment" per
     item (writes into note assessment, confirm-first).
   - **SAFETY & MORE** (bottom): interactions / red flags / trends /
     voice commands / coding — the existing card feed.
2. Transcript pane: utterance-anchored (ids from DS0) so evidence
   chips can scroll-highlight.
3. Smooth rank animation on differential updates (no flicker —
   stable ids from DS2 make this possible).
4. Instrumentation: every render/act/dismiss fires the DS3 audit
   events via the API.
5. Empty/degraded states: reasoning unavailable → rail shows
   deterministic-only mode banner (never blocks the scribe).

**Accept**: live mock-backend consult shows: differential appearing by
cycle 2, rank shifting as findings accumulate, ask-next auto-resolving
when answered, evidence chip → transcript highlight. Screenshot set
matches the approved mock direction. Web typecheck/lint green.

---

## DS5 — Rx-first artifact (the pad)

**Goal**: screens 04–06 + 09 for real — the prescription assembling
live and the signable Indian Rx pad.

**Build**:

1. Contract `packages/contracts/src/rx-pad.ts`: `RxPadV1` —
   `{ dxLine, meds[{drug,strength,frequency(1-0-1),timing?,duration,continued?}],
investigations[], adviceLines[] (bilingual ok), followUp{when,withWhat},
allergies[], vitalsLine }` + `RxPadDraftSchema` (partial, live).
2. Reasoning pass extension: emit `rxDraft` deltas (continued meds
   from patient context auto-carry as `continued`; spoken meds land
   `pending` — **confirm-first**, reusing the DV6.4 voice-command
   parser as the fast path + LLM extraction as fallback).
3. Center pane of the live UI becomes the Rx pad (per screens): Dx
   line, ℞ table with pending-row confirm UX, investigations chips,
   advice, follow-up.
4. Final pass (Pro, at End): polish Rx pad + derive SOAP note + ICD
   codes from CaseState; persist via the existing live-note route,
   extended to store `rxPad` on the NoteDraft (additive column,
   idempotent migration).
5. Sign flow: reuse the existing sign route (`SignedNoteContent`
   union gains an `RX_PAD`-carrying medical branch already covered by
   `MedicalEncounterNoteV1` — Rx pad stored alongside, signed
   together). PDF letterhead render (`components/pdf/RxPadPdf.tsx`,
   pattern: existing pdf components) + print CSS + WhatsApp share via
   the PatientShare artefact pattern (CLAUDE.md §4, follow the 6-step
   checklist; new artefact type `RX_PAD`).

**Accept**: end-to-end on mock: consult → live pad assembles →
confirm a voice med → End → signable pad ≤15 s → sign → PDF + share
link + WhatsApp snapshot; SOAP + codes persisted as byproducts; audit
trail complete.

---

## DS6 — One-tap actions + before-you-close gate

**Goal**: screens 07–08 for real. Every suggestion becomes actionable;
the single interruptive moment is built.

**Build**:

1. Card actions → real APIs: "Order ECG/troponin" → clinical-orders;
   "Swap to pantoprazole" → replace pending Rx row; "Add to plan/
   assessment" → note section append; "Accept codes" → coding accept.
   All confirm-first, all audited.
2. Gate: on End, if any `critical` item (urgent dx, RED_FLAG,
   contraindicated interaction) has no doctor action → the gate screen
   (screen 08): act now / "addressed — record my reason" (reason
   stored in audit metadata) / back. Non-critical items NEVER gate.
3. Resolved-items strip in the gate (positive reinforcement, per
   design).

**Accept**: scripted consult with an unacted red flag gates on End;
acting or reasoning-through passes; nothing else ever gates; each path
writes its audit row.

---

## DS7 — Zero-click clinic flow (queue + context flash + turnover)

**Goal**: screens 01, 02, 10 — because the verified adoption evidence
says per-consult activation is the binding constraint.

**Build**:

1. Token queue home (`/app/clinic`): today's list with token numbers,
   statuses, big next-patient card; walk-in add; becomes the doctor
   vertical's landing page.
   Data: `Session.tokenNumber` (additive column + migration) +
   queue-order API; statuses derive from session state.
2. Context flash: 3-second pre-consult screen (chronic trends from
   `/chronic`, active meds, allergies, last impression, "copilot is
   watching X") with auto-advance into listening; skippable.
3. Turnover: after sign/share, auto-arm next token (countdown,
   "wait" voice command holds); target ≤10 s between consults.
4. "Next patient" voice command (extend `voice-commands.ts` grammar).

**Accept**: simulated 5-patient clinic run: queue → flash → consult →
sign → auto-next; measured turnover ≤10 s (excluding consult time);
activation requires ≤1 click per patient.

---

## DS8 — Truth + hardening (benchmark, latency, hosting)

**Goal**: the open questions from the plan get answered with data;
prod becomes real.

**Build**:

1. **Hinglish/Manglish benchmark harness**
   (`packages/llm/src/evals/asr/`): scoring pipeline (WER + medical-WER
   - drug-name-WER against reference transcripts) + a seed set of
     synthetic/actor-recorded code-mix consults; pluggable engines
     (current Vertex path first; adapters optional later). Golden gate:
     **drug-name WER > 3% ⇒ voice-Rx stays confirm-only + banner**
     (it's confirm-first anyway — this gate blocks any future relaxation).
2. Latency regression suite: scripted PCM at 1× speed through the real
   gateway; assert §0.3 budgets p95; runs nightly (manual trigger ok).
3. Load: 50 concurrent mock sessions per gateway node; memory stable;
   graceful shed above cap (`busy` status event + UI message).
4. **Host the gateway in-region** (asia-south1 VM/containers — Vercel
   can't hold the socket): TLS `wss://`, health endpoint, systemd/
   container restart, `LIVE_GATEWAY_SECRET` set (auth required),
   `NEXT_PUBLIC_LIVE_GATEWAY_URL` on Vercel prod. Runbook:
   `docs/runbooks/live-gateway-deploy.md`.
5. DPDP check: confirm audio + transcripts only transit asia-south1;
   no audio at rest (streamed, discarded) — document in the runbook.

**Accept**: benchmark report committed (`docs/asr-benchmark.md`) with
the go/no-go call; latency suite green; prod live consult works on
`mind.cureocity.in` end-to-end with a real mic.

---

## DS9 — Pilot instrumentation + insights (the evidence engine)

**Goal**: screen 11 + the pre-registered pilot metrics — the
acceptance data that becomes our published differentiator.

**Build**:

1. Metrics rollup job + API: per-doctor per-day — consults, avg
   consult length, turnover, Rx ≤1-edit rate (diff final vs signed),
   per-card-type shown/acted/dismissed/auto-resolved, criticals caught,
   cost per consult (from DS0 meter).
2. `/app/insights` end-of-clinic view (screen 11): day summary,
   tokens/hour, acceptance bars, catches-worth-reading list.
3. Pilot config: pre-registered targets wired as dashboard reference
   lines — activation >60% of eligible consults by week 3; Rx ≤1-edit
   ≥85%; ask-next act-rate tracked (no target yet — we're generating
   the first data); reasons captured on dismiss (optional 1-tap chips:
   "wrong", "already knew", "not now").
4. Export: anonymised metrics CSV for the write-up.

**Accept**: after a simulated clinic day, insights shows correct
rollups; export produces the pilot dataset; kill-criteria thresholds
visibly tracked.

---

## Sequencing & parallelism

```
DS0 ──▶ DS1 ──▶ DS2 ──▶ DS3 ──▶ DS4        (the reasoning core — strictly ordered)
  │                        │
  │                        ├─▶ DS5 ──▶ DS6  (artifact + actions)
  │                        └─▶ DS7          (queue — parallel with DS5/6)
  └────────────────────────────▶ DS8        (benchmark harness can start day 1;
                                             hosting after DS4)
DS9 last (needs DS4–DS7 events flowing).
```

Rough sizing: DS0–DS4 ≈ weeks 1–5 (the core), DS5–DS7 ≈ weeks 5–8,
DS8–DS9 ≈ weeks 8–10 → lands inside the plan's 90-day window with
pilot time left.

## What we deliberately did NOT include

- Auto-applied anything (regulatory + trust — never).
- Speaker-attributed billing/consent flows (post-pilot).
- On-device ASR (revisit only if DS8 metering breaks the ₹3 ceiling).
- New UI primitives (compose `components/ui/*` per CLAUDE.md).
