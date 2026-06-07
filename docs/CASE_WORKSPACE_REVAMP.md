# Case Workspace Revamp — a structured, scientific client flow

> Status: **SHIPPED (Sprint 22).** Phases A–D are built and merged. This
> document is both the design rationale and the as-built reference. It
> replaces the "pile of disconnected cards" on the client page with a
> case workspace organised around how clinicians actually reason: a single
> **Case Briefing** decision surface, with everything else reframed as the
> supporting evidence the briefing is built from.

## 1. The problem, stated honestly

Today, after a session, the therapist has to mentally integrate eleven
separate cards (journey, workflow, clinical brief, pre-session brief,
diagnosis history, treatment plan, therapy library, affect, instruments,
safety, sessions list). Each is well-built in isolation. None answers
the only question that matters when a real client is sitting in front of
you tomorrow:

> **"What is going on with this person, what is still unclear, what are
> the next three things I should do, and when do I see them again?"**

Critically: Pass 3 already produces `assessmentGaps` — _the exact
diagnostic questions to ask next_ — but they are **regenerated every
session and never persisted**. The "what to ask for further diagnosis"
the therapist wants already exists in the model output and is thrown
away. That is the single biggest waste in the current design.

## 2. The scientific spine

Clinical practice has a canonical episode-of-care structure. We organise
the whole product around it instead of around MBC alone.

```
  INTAKE → ASSESSMENT → FORMULATION → TREATMENT PLANNING →
  INTERVENTION (with review cadence) → OUTCOME → TERMINATION
```

Three evidence-based mechanisms drive "what to do next":

### 2.1 The running differential (SCID/MINI logic)

Structured diagnostic interviews work by **sequencing questions to
approximate the differential-diagnostic process — continually testing
diagnostic hypotheses** until criteria are met or ruled out. The SCID is
literally "the interviewer continually testing diagnostic hypotheses as
the DSM criteria are assessed."

We already have the raw material: every `diagnosisCandidate` carries
`gapsToFill[]` (criteria still needed to confirm it) and the report
carries cross-candidate `assessmentGaps[]` (`{ question, rationale }`).
**We make these first-class, trackable items that persist and close over
sessions.** That is a running differential: a checklist of open
diagnostic questions per candidate, each tied to the ICD-11 criterion it
tests, that the therapist (or a later Pass 3) marks addressed.

### 2.2 The 5 Ps case formulation

A formulation — **Presenting, Predisposing, Precipitating, Perpetuating,
Protective** — is "not a diagnosis; it's a context map that explains
mechanisms, risk, and strengths in a way that bridges directly to
treatment planning." It is the scientific object that turns "here are
some scores" into "here is _why_ this person is struggling and therefore
_what_ to target." Pass 3's `formulation` field is currently a free-text
blob; we structure it into the 5 Ps so it (a) reads consistently and
(b) maps each perpetuating factor to a treatment target.

### 2.3 Stepped cadence

Care is staged by intensity; outcome monitoring at baseline / mid /
post / follow-up drives the spacing. Early sessions are close together
(weekly), spacing widens as the client improves, and a formal review is
due around session 8 (already encoded in `session-defaults.ts`). We
derive a **recommended next-session interval** deterministically from
stage + instrument trajectory + the plan's `expectedDurationSessions` —
not a hard RCT threshold, but a defensible heuristic the therapist can
override.

Sources: psychotherapy episode structure + DBT assessment-driven
formulation (ScienceDirect); SCID-5 user guide + SCID vs MINI (APPI /
Proem); 5 Ps formulation (Psychology Tools "FRIENDLY", Supanote clinical
guide); five stages of the clinical interview (Sommers-Flanagan).

## 3. What already exists vs what we build

**Reuse (already in the codebase):**

- `IntakeNoteV1` (intake history + MSE + working hypothesis).
- Pass 3 `InitialAssessmentBriefV1.assessmentGaps` + `differential[].gapsToFill`
  — the diagnostic questions. **Source of truth for the new tracker.**
- `ClinicalReportV1.formulation` / `treatmentPlan` / `recommendedTherapies`.
- `InstrumentResponse` + the reliable-change engine (`change-score.ts`).
- `TreatmentEpisode` + `TreatmentGoalProgress` (Sprint 20/21).
- `session-defaults.ts` (kind + cadence inputs).
- Klara chat route (`/api/v1/klara/chat`) — extend to be client-aware.

**Build (new):**

1. **`AssessmentItem`** — a persisted, trackable diagnostic/assessment
   question (the running differential). See § 4.
2. **`CaseBriefing`** (Pass 6) — the single synthesis: what's going on
   (5 Ps), open items, next 3 actions, next-session timing. Deterministic
   skeleton + LLM narrative with a deterministic fallback. See § 5.
3. **The Case Workspace** — restructured `/app/clients/[id]`. See § 6.

## 4. New model — the running differential

```prisma
enum AssessmentItemStatus {
  OPEN          // still needs to be asked / assessed
  ADDRESSED     // asked this session, partial / in progress
  CLOSED        // criterion resolved (confirmed or ruled out)
}

enum AssessmentItemKind {
  DIAGNOSTIC_CRITERION   // from differential[].gapsToFill — tests an ICD-11 criterion
  ASSESSMENT_GAP         // from report.assessmentGaps — general info needed
  INSTRUMENT             // "administer PHQ-9 baseline"
  SAFETY                 // "complete safety plan", "ask about SI directly"
}

model AssessmentItem {
  id              String   @id @default(cuid())
  clientId        String
  episodeId       String?               // groups items within one episode of care
  psychologistId  String
  kind            AssessmentItemKind
  question        String                // "How many discrete panic attacks in the last month?"
  rationale       String                // "Required for ICD-11 6B01 frequency criterion."
  /// Optional link to the diagnosis candidate this item tests.
  icd11Code       String?
  status          AssessmentItemStatus  @default(OPEN)
  /// Where it came from (Pass 3 of which session) + where it was closed.
  sourceSessionId String?
  addressedSessionId String?
  resolutionNote  String?               // therapist's answer/finding when closing
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  closedAt        DateTime?

  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@index([clientId, status])
  @@map("assessment_items")
}
```

**Lifecycle:**

- **Generated** when Pass 3 runs: a reconciler turns the brief's
  `assessmentGaps` + each candidate's `gapsToFill` into `AssessmentItem`
  rows (deduped against existing OPEN items by normalised question text,
  so re-running Pass 3 doesn't create duplicates — it just adds genuinely
  new questions).
- **Carried forward** across sessions — they don't reset.
- **Closed** two ways: (a) therapist clicks "answered" + types a one-line
  finding; (b) when a later Pass 3 no longer lists a previously-open gap,
  it's auto-suggested as resolved (therapist confirms).
- **Drives the briefing**: open items = "what to ask next session". This
  is the persistent SCID-style running differential the product is
  missing.

New audit actions: `ASSESSMENT_ITEM_CREATED`, `ASSESSMENT_ITEM_CLOSED`.

## 5. The Case Briefing (Pass 6) — the synthesis

A single object, recomputed when state changes, that answers the four
questions. **Deterministic skeleton always present; LLM narrative
layered on top with a deterministic fallback** so it works in dev
(mock) and degrades safely if GCP is down.

```ts
CaseBriefingV1 {
  // WHAT'S GOING ON — the 5 Ps formulation, structured.
  formulation: {
    presenting:   string;
    predisposing: string;
    precipitating:string;
    perpetuating: string;   // each maps to a treatment target
    protective:   string;
  };
  workingDiagnosis: { icd11Code, icd11Label, confidence, confirmed } | null;
  // WHAT'S STILL OPEN — pulled from AssessmentItem (status=OPEN), ranked.
  openItems: { id, kind, question, rationale, icd11Code? }[];
  // NEXT 3 ACTIONS — prioritised, each with why + when.
  nextActions: {
    title: string;            // "Confirm the GAD diagnosis"
    detail: string;           // grounded in this client's data
    why:    string;           // the clinical reason
    when:   'this_session' | 'next_session' | 'this_week' | 'before_review';
    cta?:   { label, href };  // deep link (administer instrument, open brief…)
  }[];                        // exactly 1-3
  // WHEN TO SEE THEM AGAIN.
  cadence: {
    recommendedIntervalDays: number;   // 7 / 14 / 21 …
    rationale: string;                 // "Weekly while symptoms are moderate+"
    reviewDueInSessions: number | null;
  };
  // SAFETY — surfaced, never buried.
  safety: { highestSeverity, openCrisisFlags: string[], hasSafetyPlan: boolean };
  generatedAt: string;
  source: 'llm' | 'deterministic';
}
```

Pass 6 input = the whole cumulative record for ONE client (intake note,
latest Pass 3 brief, open AssessmentItems, confirmed diagnosis, active
plan + goal progress, instrument trend + verdicts, exercise adherence,
crisis flags, safety plan, last 3 session summaries). Output = the above.
Built the standard way (router method, vertex + mock backend, prompt
constant, `PASS_6_CASE_BRIEFING` observability enum, migration). The
mock returns a deterministic briefing so CI + dev work without GCP.

## 6. The UX — Case Workspace (as built)

`/app/clients/[id]` is rebuilt from a flat card-pile into a **decision
surface + supporting evidence**. The Case Briefing is rendered full-width
as the anchor immediately under the identity card; a labelled
"Clinical record & evidence" divider then introduces the existing cards,
which are reframed (not rebuilt) as the data the briefing is built from.

We deliberately kept the existing full-width cards (Journey, Workflow,
Instruments, Therapy Library, Affect, …) rather than squeezing them into
a right rail — they're already designed full-width, the single-column
"anchor → evidence" flow reads top-to-bottom on mobile, and the
hierarchy is carried by order + the divider, not by columns. (A future
refinement could move outcome-measures + safety into a sticky right rail.)

```
┌──────────────────────────────────────────────────────────────────────┐
│  shahid                                                       [ACTIVE] │
│  32 years · Client since Jun 2026 · phone / email                      │
│  Presenting concerns: …                                                │   ← identity card
├──────────────────────────────────────────────────────────────────────┤
│  CASE BRIEFING                                  [computed] [↻ Refresh] │   ← THE anchor
│  Working diagnosis: Adjustment disorder (working, 55%)                 │
│  ⚠ Safety — severity high: suicidal ideation. No safety plan on file. │   ← only when present
│  ▸ What's going on — 5 Ps formulation        (collapsible)            │
│                                                                        │
│  Still open · 4   (what to ask / assess next)                          │
│  ◯ Symptom-onset timeline vs stressor  · rules AdjD vs MDD   [6A72]    │
│  ◯ Anhedonia probe                                                     │
│  ◯ Sleep hours/night                                                   │
│  ◯ Worry pervasiveness                                                 │
│                                                                        │
│  Do next                                                               │
│  1. Open with the onset-timeline question     [Next session]          │
│     Why: closes the AdjD/MDD distinction.                              │
│  2. Set a baseline — administer PHQ-9 + GAD-7  [This session] [CTA]   │
│  3. Assign a behavioural-activation log        [This week]            │
│                                                                        │
│  Next session: in ~7 days  · weekly while symptoms are moderate+       │
│  ▸ Ask about shahid   ← client-aware chat                             │
├──────────────────────────────────────────────────────────────────────┤
│  CLINICAL RECORD & EVIDENCE ─────────────────────────────────────────  │   ← divider
│  Journey (measured progress) · Pre-session brief · Diagnosis history · │
│  Workflow · Instruments · Therapy library · Affect · Data rights ·     │
│  Sessions                                                              │
└──────────────────────────────────────────────────────────────────────┘
```

UX principles:

- **One anchor, not eleven.** The Case Briefing is the centre of gravity;
  everything else sits below a divider as supporting evidence.
- **Safety surfaces first**, never buried — a high/critical severity
  renders a banner at the top of the briefing before anything else.
- **Open items are a checklist, not prose** — the therapist closes them
  with one tap + a one-line finding. Synthetic items (baseline / safety
  the journey implies) are shown but resolve when the action is done.
- **Every action has a _why_ and a _when_** — research on decision-support
  adoption: clinicians trust suggestions that show reasoning and respect
  autonomy.
- **"Ask about shahid"** opens a client-aware chat (Klara, scoped to this
  client) for stuck-points — grounded in the same cumulative record.
- The recording / note / clinical-brief flow on the **session** page is
  unchanged; what changes is that confirming the brief now (a) writes the
  formulation 5 Ps, (b) reconciles AssessmentItems, (c) refreshes the
  briefing.

## 7. End-to-end walkthrough (the felt experience)

1. Therapist records shahid's intake → note → Initial Assessment runs.
2. Pass 3's gaps become **4 open AssessmentItems** (onset timeline,
   anhedonia, sleep, worry pervasiveness), each tied to the criterion it
   tests.
3. The Case Workspace opens to a **briefing**: 5 Ps formulation,
   the 4 open items, **3 concrete next actions with why + when**, and a
   **next-session recommendation (~7 days, review at session 8)**.
4. Session 2: therapist opens with the onset-timeline question. After the
   session, they tick "onset timeline" closed with a one-line finding;
   the differential narrows; the briefing updates.
5. Once enough criteria close, the brief lets them confirm the diagnosis
   - plan; the stepper advances to **Treatment**; the briefing's next
     actions switch to intervention + the re-measure cadence.
6. The MBC loop (Sprint 20) takes over for the treatment arc; the
   workspace shows the verdict and, at remission, the discharge + outcome
   report.

## 8. Phased build

Each phase is independently shippable + testable; all deterministic
pieces work in dev/CI without GCP.

- **Phase A — Running differential (the keystone, mostly deterministic).**
  `AssessmentItem` model + migration + contracts; reconciler that turns
  Pass 3 gaps into items (wired into `runClinicalAnalysis`); a
  `GET/PATCH /clients/[id]/assessment-items` API; an **Open items**
  checklist component. This alone fixes the biggest waste (gaps no longer
  evaporate) and is shippable without any new LLM.

- **Phase B — Case Workspace shell + deterministic briefing.** Rebuild
  `/app/clients/[id]` into the two-column workspace; structured 5 Ps
  formulation (parse from the existing free-text formulation + the
  intake note, deterministic first); deterministic next-actions +
  cadence engine (extends `journey.ts`). No new LLM yet — proves the UX.

- **Phase C — Pass 6 case-briefing LLM.** Add the pass (vertex + mock),
  contracts, route; the LLM produces the richer 5 Ps narrative + ranked
  next actions, with the Phase-B deterministic version as the guaranteed
  fallback. Cache per client + invalidate on state change.

- **Phase D — Client-aware chat.** Extend the Klara route to accept
  `clientId` and load the cumulative record; embed "Ask about <client>"
  in the workspace.

## 9. Honest constraints

- **Pass 6 needs GCP to produce the real narrative.** Phases A + B are
  fully deterministic and verifiable in dev; Phase C's _LLM quality_ can
  only be judged with a real Vertex key, but its plumbing + fallback are
  CI-testable with the mock.
- **5 Ps structuring of old free-text formulations** is best-effort —
  legacy reports without structured Ps fall back to showing the existing
  prose.
- **Cadence is a defensible heuristic, not a hard RCT cutoff** — always
  therapist-overridable.
- This is a real revamp (new model, new pass, page rebuild) — ~4 PRs,
  not a single commit.
