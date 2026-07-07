# DS11 — Consult UX v3: live-first, two plans, one surface

**Status:** planned (2026-07-07). Successor to the DS0–DS10 arc
(`DOCTOR_SCRIBE_V2_SPRINTS.md`). This plan was synthesized from a codebase
map (entry points, live surface, batch/upload paths, clinical capabilities),
competitor research (Heidi, Freed, Suki, Abridge, Nabla — 2025/26 patterns),
and three independent design passes (OPD-throughput, clinical-trust,
first-week-adoption lenses). All three converged on the same core moves.

## North star

> A doctor moves queue → live consult → signed Rx → next patient on **one
> surface**: zero taps to start, everything they *say* lands on **their**
> plan, everything the AI proposes stays visibly quarantined until a
> deliberate tap adopts it, and the sign takes under 20 seconds with no
> duplicate review. Live is the main flow; Dictate and Upload are explicit
> alternate modes; everything keeps working when the AI is off.

## Ground truth being fixed

- The clinic queue already routes to live (`ClinicBoard.tsx` →
  `/live?flash=1`), but the patient-chart `+ Start encounter` lands on the
  **batch** workspace with live demoted to a "⚡ Try the live copilot
  (preview)" link — stale DV4 copy. Live vs batch is an accident of URL,
  never a modeled choice.
- Live consults never set `Session.status` (`IN_PROGRESS`/`COMPLETED`), so
  queue statuses lie and the sign route can reject live-only consults.
- After End, the doctor is detoured (`FinalNote` → "Open the encounter →")
  to a second page that re-renders the note and re-asks for confirmations —
  a double ceremony.
- Exam prompts don't exist live; lab suggestions are buried post-consult in
  the differential card; the DS10-B plan composer only exists post-consult.

## Key design decisions (with rationale)

1. **Live is the default everywhere; mode choice is progressive-disclosed,
   never a modal.** The Ready screen (evolved ContextFlash) shows
   `Capture mode: Live · Change`; the patient-chart button becomes a split
   button (Live primary; Dictate/Upload in the caret). Rationale: Freed's
   one-tap zero-config start is the most-praised pattern in the market;
   per-visit mode/template prompts are a documented anti-pattern.
2. **Meds confirm-first; tests/advice auto-land with a 10s undo.** Spoken
   orders parse into "Your plan": a med arrives as a *heard — Confirm* row
   (one tap), a test/advice line lands immediately with undo. Rationale:
   hallucinated/misheard drug names are the #1 clinician complaint about
   ambient scribes; investigations are lower-risk and confirm-fatigue is
   real at 60 patients/day.
3. **Linked evidence everywhere.** Heard rows carry a 🗣 quote-chip that
   scroll-highlights the source utterance (the DS4 anchoring already
   exists). Rationale: Abridge's linked evidence is *the* trust mechanism
   (Best in KLAS 2025+2026).
4. **One pad, two lanes, one ceremony.** The live Rx pad becomes the
   two-lane Plan Pad (YOUR PLAN solid / AI SUGGESTS dashed); the DS10-B
   PlanComposer semantics move INTO the consult; at sign-off the pad
   arrives pre-resolved — items confirmed live are never re-confirmed.
5. **Transcript visible but collapsed** to a strip (Nabla/Heidi users cite
   the live transcript as capture reassurance; a full column is noise).
6. **The rail is ordered by urgency and capped:** Alerts → Ask → Examine →
   Order → Differential, max ~3 visible per group with a "more (n)" count.
   Acted cards leave the rail.
7. **Graceful AI-off:** gateway preflight on the Ready screen; on failure
   every live entry point offers one-tap Dictate with honest copy. Live
   becoming main makes this load-bearing, not a nicety.

## The three screens (mockups: ds11-mockups)

1. **Ready screen** — patient + chronic chips + "copilot is watching"
   chips + countdown (gated on the chronic fetch) + mode pills behind
   *Change*. First tap of the day doubles as the mic-permission gesture.
2. **Live Consult Room** — capture bar; transcript strip (collapsed);
   center: self-writing note + two-lane Plan Pad; right: Alerts / Ask /
   **Examine** / **Order** / Differential.
3. **Review & Sign** — same page after End: note rendered once (inline
   edits), plan pre-resolved (✓ rows), collapsed "AI still suggests (n)"
   disclosure, honest "Not examined: …" line, sticky **✓ Sign & next
   patient** which fires sign + Rx share and only then arms the 10s
   turnover.

## Sprints (each ships alone)

| # | Sprint | Scope | Est |
|---|--------|-------|-----|
| DS11.1 | **Session lifecycle truth** | Live capture-start sets `IN_PROGRESS`; live-note persist sets `COMPLETED`. Queue statuses/doneCount/hrefFor/TurnoverBar become correct; the sign route stops failing live-only consults. Regression matrix across LIVE×sign and the therapist flows. | 1–2d |
| DS11.2 | **One Review & Sign surface** | Extract a shared `ReviewAndSign` (note + PlanComposer + sign + share) from `DoctorEncounterPanel`; render it as the live page's done state; kill `FinalNote`'s detour; "Sign & next patient" arms TurnoverBar only after sign; "New consult" mints a NEW session row. | 2–3d |
| DS11.3 | **Mode model + live-as-main** | `Session.captureMode (LIVE\|DICTATE\|UPLOAD)` + idempotent migration + audit; StartEncounterButton → split button (Live primary → `/live?flash=1`); delete "(preview)"; Ready screen v2 (countdown gates on chronic fetch, mode pills behind Change, first-tap mic priming); encounter workspace becomes mode-aware archive/capture. | 2d |
| DS11.4 | **Gateway preflight + graceful degrade** | `GET /api/v1/live/health`; wss enforcement on https; live entries degrade to a one-tap Dictate banner; mic-failure re-renders StartPanel (no dead ends). | 2d |
| DS11.5 | **Two-lane Plan Pad live** | YOUR PLAN (heard-confirm med rows + 🗣 quote-chips; tests/advice auto-land + undo) vs AI SUGGESTS (adopt/dismiss, audited, capped at 3 visible); full-normalised-string medKey dedupe; sign-off consumes live resolutions — no double confirmation. | 2–3d |
| DS11.6 | **Examine + Order first-class** | `LiveReasoning` contract gains `examineNext[]` + `orderNext[]`; gateway reasoning emission + prompt; rail groups Ask/Examine/Order with the ask-next chip grammar (✓ done writes an examined line into the note; dismiss-with-reason audited); "Not examined: …" line at sign; specialty-aware Ready chips. | 2–3d |
| DS11.7 | **Dictate + Upload modes** | Dictation-tuned Pass-2 prompt variant (doctor-stated orders attribute to YOUR PLAN); upload panel reuse for doctors; per-doctor preferred-mode setting; both land on the same ReviewAndSign. | 2–3d |
| DS11.8 | **Calm + polish pass** | Rail max-3 + "more (n)"; acted-card exit animations; lane-adoption motion; empty/error/AI-off states; reduced-motion; consistent serif/soft-surface treatment Ready → Live → Sign. | 2d |

Order rationale: 11.1 unblocks everything (status truth + signing);
11.2 removes the double ceremony (biggest felt win); 11.3 flips
live-to-main safely once signing works; 11.4 must land before or with
11.3 (live-as-main needs the fallback); 11.5–11.6 are the founder's
two-plans + exam/labs asks; 11.7–11.8 complete the mode story and polish.

## Risks

- **Gateway fragility becomes main-flow fragility** → DS11.4 is
  load-bearing; do not let it slip behind the UI sprints.
- **Code-mixed voice-order parsing** ("CBC karva lo, paracetamol 650 TDS")
  will mishear — confirm-first on meds + quote-chips mitigate; watch the
  DS9 ≤1-edit metric for regressions.
- **Confirm fatigue → blind bulk-confirm** at high volume; keep hard stops
  only for interaction/dose-range violations.
- **Session-status change touches shared queue/journey logic** — regression
  coverage on `deriveQueueStatus` + therapist flows before shipping.
- **Exam-prompt dismissal audit is clinically sensitive** — the "Not
  examined" wording needs clinician sign-off before pilot.
