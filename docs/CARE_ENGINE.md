# The Care Engine — the therapist Journey page (JE1–JE6)

**Status: SHIPPED.** This is the operational guide for the Journey sub-tab of
the session workspace (`?tab=copilot&sub=journey`) — the longitudinal
"where is this client and what do I do" surface — and for the deterministic
engine that drives it.

Read alongside `docs/THERAPIST_COPILOT_V2.md` (the per-session decision
board) and `docs/MEASUREMENT_BASED_CARE.md` (the Sprint-20 conceptual model
this builds on).

---

## 1. Why it exists

The old Journey page was stitched from five components with **two competing
action engines** (the journey's next-best-action + the case briefing's
3-item do-next, plus synthetic list items). The same fact rendered up to
four times ("set a baseline" ×4, "safety plan" ×3), cadence contradicted
itself ("5d" vs "~7 days"), and nothing explained _why_ the client was in a
given stage.

The Care Engine replaces the rules with **one pure state machine** and the
page with **four calm cards** where every fact has exactly one home.

## 2. The rule: one home per fact

| Fact                              | Its ONE home                          |
| --------------------------------- | ------------------------------------- |
| Stage + what earns the next stage | Card 1 · Care journey (the checklist) |
| What to do next (every action)    | Card 1 · the same checklist + "Also"  |
| Working diagnosis                 | Card 1 · header (right side)          |
| Safety / crisis state             | Card 1 · the SAFETY checklist row     |
| Scores, verdicts, due states      | Card 2 · Is it working?               |
| Plan goals + affect baseline      | Card 2 · subsections                  |
| The narrative (headline, 5 Ps)    | Card 3 · The story so far             |
| AI tools (chat, case consult)     | Card 3 · folded sections              |
| Cadence + next booked session     | Card 4 · Next session (header line)   |
| Carried/open questions            | Card 4 · ranked list, one-tap close   |
| The AI pre-session brief          | Card 4 · unique fields only           |

The brief's crisis banner and instrument-score list are **deliberately not
rendered** — those facts live in cards 1 and 2. If you add anything to this
page, first ask which card owns the fact; never render it twice.

## 3. The four cards

1. **Care journey** (`CareBoard.tsx`) — the stage strip (Intake →
   Assessment → Formulation & plan → Active treatment → Review & outcome),
   then the current stage's exit gate rendered **as** the do-next checklist:
   a met criterion is a ✓ with its evidence ("6A70 · accepted 11 Jul"); an
   open criterion **is** the queue action that satisfies it, inline (title,
   why, priority chip, CTA). Actions no criterion references (re-measure,
   plan review, discharge) follow under "Also". Discharge + Share sit at the
   bottom; a closed episode shows the discharge banner + any post-discharge
   actions (a late safety flag outranks everything).
2. **Is it working?** (`CareMeasurePanel.tsx`) — one row per tracked
   instrument: due badge, baseline → latest → Δ → reliable-change verdict
   (+ response/remission), with the administration form expanding **inline**
   under the row. Submitting scores calls `router.refresh()` so card 1's
   checklist updates immediately. History folds behind one toggle. Plan
   goals (tap to cycle status) and the affect baseline follow.
3. **The story so far** (`CareStoryPanel.tsx`) — the briefing headline, the
   collapsible 5 Ps formulation, and two folded AI tools: "Ask about
   {client}" chat and the case consult (`CaseConsultPanel`, fetches only
   when opened; auto-opens on the `#care-consult` hash).
4. **Next session** (`CareNextSessionPanel.tsx`) — the cadence line
   ("Booked for 16 Jul · every ~7 days" + the reason), the engine's ranked
   carried questions (rank chip, stale flag, one-tap close with retry,
   "show all N"), then the Pass-5 brief's unique fields (context line, last
   session, today's focus, opening line, watch-fors, homework).

## 4. The engine (pure, deterministic, no LLM)

`packages/clinical/src/journey/care-engine.ts` — `computeCareEngine(input)`
→ `CareEngineV1` (`packages/contracts/src/care-engine.ts`). Pure: no I/O,
no clock (`now` is an input), same record → same screen.

**Stages + exit gates.** INTAKE (gate: first session recorded) →
ASSESSMENT (gate: diagnosis accepted + safety addressed + baseline
measured) → FORMULATION (gate: plan accepted) → ACTIVE*TREATMENT →
REVIEW (reached at 8 sessions since the plan, or earlier on remission).
A stage is \_earned* — the gate says exactly what's missing and why.

**The queue.** At most one action per priority band, strict order
`SAFETY > MEASURE > DIAGNOSE > PLAN > OUTCOME`. Each action carries the
gate criterion it unlocks (`unlocks`) and each criterion carries the id of
the action that satisfies it (`unlocksActionId`) — the UI joins them into
the single checklist.

**Safety coverage (clinical invariant).** A safety plan only counts as
addressing the current crisis if it was **confirmed on/after the most
recent open flag**. A stale plan for a past concern re-raises the SAFETY
action as "Update the safety plan for the new risk". A critical flag
surfacing **after discharge** still raises a SAFETY action.

**Measures.** `deriveMeasureDue` is the single source of truth for the due
state — the per-card badge and the "re-measure" queue action derive from
the SAME function, so they can never contradict. Cadence: re-measure due at
14 days during active treatment; verdicts come from the Sprint-20
reliable-change engine (thresholds are clinician-signed — do not touch).

**Questions.** Ranked safety > differentiate (ASSESSMENT_GAP) > confirm
(DIAGNOSTIC_CRITERION) > context, oldest first within a rank; stale after
surviving 3 completed sessions; only genuinely `OPEN` items count
(`ADDRESSED` = already asked). `top` is the head of `all`.

**Thresholds** live in one block: `CARE_ENGINE_CONSTANTS`
(REVIEW_AT_SESSIONS 8, REMEASURE_DUE_DAYS 14, QUESTION_STALE_AT_SESSIONS 3,
TOP_QUESTIONS 3, NOT_IMPROVING_MIN_ADMINISTRATIONS 3).

## 5. The compose layer

`apps/web/lib/care-engine-compose.ts` — `computeCareEngineForClient(clientId,
psychologistId, sessionId)`. Reuses `computeClientJourney` (ownership check,
reliable-change verdicts, active plan, working diagnosis) and adds: open
high/critical crisis flags **with the latest flag time**, the active safety
plan **with its confirmedAt** (the coverage rule), per-instrument
administration counts/dates (episode-scoped), `OPEN` assessment items,
completed-session end times (staleness), and the next booked session.

## 6. Where to look

| Change…               | File                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| A rule / threshold    | `packages/clinical/src/journey/care-engine.ts` (+ spec)                                                      |
| The DTO               | `packages/contracts/src/care-engine.ts`                                                                      |
| What the engine reads | `apps/web/lib/care-engine-compose.ts`                                                                        |
| The page composition  | `AICopilotTab.tsx` → `JourneySub`                                                                            |
| Card 1 / 2 / 3 / 4    | `CareBoard` / `CareMeasurePanel` / `CareStoryPanel` / `CareNextSessionPanel` (in `apps/web/components/app/`) |

## 7. Gotchas

- **Anchor contract:** the engine emits CTAs to `#care-measures` (card 2's
  wrapper id) and `#care-consult` (card 3's consult fold, which auto-opens
  on that hash). If you rename/move these ids, update the engine's hrefs.
- **After any write that changes engine facts** (scoring an instrument,
  closing a question, toggling a goal) call `router.refresh()` — the board
  is server-rendered and must re-derive.
- **Date labels** (`fmtDay`) are IST calendar days baked into the DTO.
- The old components (`EpisodeStepper`, `TodayStrip`, `JourneyHeader`,
  `CaseBriefingPanel`, `InstrumentRunner`, `PreSessionBriefCard`, `CareArc`,
  `CareDoNextQueue`) are **deleted** — don't resurrect them; extend the four
  cards instead.
- The engine's spec (`care-engine.spec.ts`) is the contract for every rule
  above — new rules need a test, and the safety-coverage tests must never
  be weakened.
