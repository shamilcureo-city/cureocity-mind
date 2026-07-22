# Sprint 21 — Incremental polish on Sprint 20

After the measurement-based-care loop landed (Sprint 20), four
self-contained pieces shipped to round out the experience. None
change the underlying loop; they make existing data visible,
extend an existing feature to intake notes, and give the therapist
a self-reflection surface.

## 1. Diagnosis history card

**File:** `apps/web/components/app/DiagnosisHistoryCard.tsx`,
wired in `apps/web/app/app/clients/[id]/page.tsx`.

Cumulative `ClientDiagnosis` rows accumulate as the therapist
confirms diagnoses across sessions, but until Sprint 21 there was
no UI surface for them — only the audit trail. The card sits
above WorkflowSection on the client page and shows:

- **Current** rows (`supersededAt = null`) with the primary
  badge + confidence percentage.
- **Earlier (superseded)** rows underneath, dimmed, with their
  confirmed + replaced dates so the therapist can see how the
  formulation evolved.

Read-only — diagnoses are confirmed from the Clinical Brief. No
schema or contract change. Pure server-rendered query.

## 2. Intake-note AI modify panel

**Files:** `apps/web/app/api/v1/sessions/[id]/note/modify/route.ts`
(now kind-aware), `apps/web/components/app/IntakeModifyPanel.tsx`
(new), wired in `apps/web/components/app/NotesTab.tsx` intake
branch.

The Sprint 19 intake notes tab was read-only with a "modify panel
is not supported" message. Sprint 21 makes the modify route
kind-aware: when `session.kind === 'INTAKE'` it uses the
`INTAKE_SYSTEM_PROMPT` and parses against `IntakeNoteV1Schema`
(server-side risk-severity preservation included). The new
`IntakeModifyPanel` is a sibling of the SOAP `ModifyPanel`:

- Quick-action chips (`Tighten the history section`, `Rewrite mental
status exam as a prose paragraph`, `Remove any specific names from
social history`, `Make the immediate plan more concrete`).
- Free-text textarea.
- A change summary readout ("Last run changed: history, plan").

**Sign-off for intake notes is still deferred** — the sign route's
WebAuthn binding + per-field edit-diff verification is rigidly
TherapyNoteV1-shaped (`'subjective' | 'objective' | 'assessment' |
'plan'`). Generalising the sign contract for both note shapes is a
larger refactor than a single Sprint 21 PR can safely cover.

## 3. Therapist My Practice view

**File:** `apps/web/app/app/me/page.tsx`, sidebar link in
`apps/web/components/app/Sidebar.tsx`.

The admin Competency dashboard (`/console/competency`) already
computed per-therapist signal; Sprint 21 surfaces that signal to
the therapist themselves at **`/app/me`** with self-reflective
framing.

What it shows:

- **Headline tiles** — active clients, sessions (last 30 days +
  lifetime), clinical briefs.
- **AI suggestion decisions** card — accepted / modified / rejected
  tally with percentages, plus an explicit caveat:
  > "Modifying or rejecting isn't worse than accepting — the right
  > call depends on the AI being right. A balanced split is normal."
- **Tempo card** — median time to confirm a clinical brief, crisis
  flags raised, episodes closed, progress reports shared (the
  Sprint 20 audit actions feed straight in here).
- **Footer tiles** — therapy scripts, pre-session briefs,
  instruments administered, patient shares.

Deliberate omissions: no comparison against colleagues, no
percentile ranks, no "best therapist" leaderboards. Adoption
research on competency dashboards is unambiguous — comparative
framing gets the surface abandoned.

Auth is still dev-fixture bound (`firebaseUid =
'dev-firebase-uid-priya'`) like the rest of `/app/*`; drops in
cleanly under the real Firebase auth cutover.

## 4. Per-goal achievement status

**Files:** `prisma/schema.prisma` (`TreatmentGoalProgress`,
`TreatmentGoalStatus`), migration
`20260622020000_sprint20_goal_progress`,
`packages/contracts/src/clinical.ts` (`TreatmentGoalStatusSchema`,
`UpdateGoalProgressInputSchema`),
`apps/web/app/api/v1/treatment-plans/[id]/goals/[index]/route.ts`,
`apps/web/lib/journey.ts` `buildActivePlan`,
`apps/web/components/app/JourneyHeader.tsx` `GoalRow`.

Treatment-plan goals were inert `{ description, measure }` pairs.
Sprint 21 added a per-goal `NOT_STARTED | IN_PROGRESS | ACHIEVED`
status, kept in a **side table** (`TreatmentGoalProgress`) keyed by
`(treatmentPlanId, goalIndex)` so toggling status doesn't
re-version the plan and historical plans keep their own progress.

UI: each goal row on the Journey hub gets a clickable status dot
that cycles through the states with an optimistic update + a
`router.refresh()`. Achieved goals strike through; the journey
header shows an **"X of Y achieved"** tally. Disabled on a
discharged arc.

## 5. What did NOT ship

These were considered + deliberately deferred:

- **Intake sign-off** — explained above. Needs a sign-contract
  refactor.
- **Multilingual progress report copy** — Malayalam / Hindi /
  Tamil therapeutic copy needs a native/clinician check; the
  codebase explicitly forbids machine-translating clinical content.
- **More scored instruments (WHODAS-2, PCL-5)** — their validity
  depends on _exact_ validated item wording; clinician sign-off
  required before patients see them.
- **Treatment-plan inline edit** — Clinical Brief's plan section
  is still "Accept or reject" (no Edit-and-Accept). Real work,
  not safe to ship blind.
- **Real Firebase auth cutover** + **PII field encryption** —
  pilot blockers; need your live env to verify, not safe to ship
  blind.

See `CLAUDE.md` § 11 for the full backlog with priority tiers.
