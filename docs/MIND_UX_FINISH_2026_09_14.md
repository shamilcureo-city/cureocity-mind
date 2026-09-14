# Mind: finish the psychologist journey

14 September 2026. This bounded software batch is implemented and locally checked;
the full product programme remains open. Not a release or clinical approval.

Branch: `codex/mind-product-release-20260913`, based on
`501754fc61ab1e40f25dce8edd6548d7b6ba02e9`. The changes described here are
uncommitted and are not in PR #157's existing checked head or hosted preview.
No commit, push, merge, migration, deployment or account activation in this turn.

## Design plan

Keep Mind's established identity: lavender paper `#f4f5fc`, white work surfaces,
ink `#232339`, iris actions `#6659c9`, amber warnings `#815600` and forest saved
states `#22734c`. Fraunces is for client/headings; Inter is for controls and
clinical text. Left-align the work, bound reading width, and keep keyboard focus
visible. Reuse existing tokens rather than introducing a second theme.

```text
Prepare: client + visit → optional focus → explicit Start
Session: capture controls → safety → one guide step or question
                                    → optional other support
Finish:  source + note → explicit correction/sign
                      → optional work / agreement / appointment
```

Review against the brief: this is a psychologist's working space, not a
marketing dashboard. Keep the client's record central; no decorative scores,
streaks, competing suggestion lists or forced clinical completion checklist.
Use the same action names throughout. Viewing a guide is not delivering therapy;
opening an optional task is not saving it; saving a note is not signing/sharing it.

## Implementation scope

- Calm session support with one ordinary item in focus and all safety cues visible.
- One optional closeout workspace; retain editors and independent save/error states.
- Understandable therapy categories and AI-draft provenance; no invented approval.
- Review proposed AI narrative edits before changing the note, with a stale-draft guard.
- Consistent Review & finish wording, keyboard/reflow and regression checks.

## Verification plan

- Unit/handler tests: hidden suggestions are not reported shown; disclosure does
  not resolve them; capability boundaries and partial failures remain independent.
- Note rewrite: preview makes no draft write; apply uses current-version and
  recovery guards; malformed/stale responses cannot overwrite the note.
- Browser: development-only fictional preview, keyboard, narrow viewport,
  focus/disclosures and proposed-edit comparison. No microphone, paid model,
  patient records or production account activation.
- Run web tests, typecheck, scoped lint and formatting; report skipped checks.

## Implemented behavior

- Guided session presents one ordinary question/topic at a time; other support
  is under one disclosure. Safety concerns remain visible in Quiet and Guided.
  Hidden suggestions are not reported as shown or recorded as completed.
- Therapy choices are grouped by purpose. A guide opens with its AI-draft and
  suitability notices, then offers single-section navigation and visible saved
  place. Moving through sections does not record delivered therapy.
- Review puts the note first and optional work, agreements, appointment and
  support below. Loaded editors stay mounted when switching tasks. Metadata-only
  status notices keep pending/dirty/error states visible outside collapsed tasks.
  Actual work requires the therapy-workflow capability. Fresh server evidence
  outranks earlier local skip acknowledgements.
- Mind's unsigned-note **writing suggestion** panel now previews proposed
  narrative changes without saving them. Explicit review and apply use the
  existing version/recovery-guarded draft API. Safety and modality fields remain
  unchanged; stale derived summaries/evidence are cleared on canonical edits.
  Competing note/template actions are blocked during the request. An uncertain
  apply, including a response arriving after timeout, requires reloading saved
  state and cannot claim the changes were not applied.
- This is not a new universal AI-edit framework: legacy translation/direct-apply
  callers retain their existing flow. Source-history attribution is not invented.
- Booking success requires a valid receipt. A lost, malformed or uncertain
  booking response retains the form and blocks blind repeat submission. Today
  opens in a separate tab to check actual bookings. This is duplicate prevention,
  not automatic server reconciliation or a new idempotency API.
- Mind uses **Review & finish** consistently in the touched journey. Scribe's
  separate Review & Sign terminology and doctor-specific workflow are preserved.

## Final local verification

Node `22.23.2`; completed 14 September 2026 after final reviewer fixes.

| Check                                 | Result                              |
| ------------------------------------- | ----------------------------------- |
| Full web suite                        | 266 files; 2,348 passed, 37 skipped |
| Full contracts suite                  | 39 files; 460 passed                |
| Web typecheck / contracts build       | Passed                              |
| Scoped ESLint, formatting, whitespace | Passed                              |

The 2,808 passing tests are suite totals, not new-test counts or clinical accuracy.
The 37 explicitly skipped tests require opt-in database-backed execution; they
are not passed. Route and failure-path tests use controlled/mocked responses.
The independent review found and fixed hidden errors, incorrect work capability,
stale local decisions, booking uncertainty and late post-timeout save handling.

Browser checks used local development-only fictional fixtures with closed
transports and `LLM_BACKEND=mock`, not a practitioner account or clinical API:

- Quiet/Guided disclosure, one primary question and persistent safety cues.
- Guide suitability gate, next/previous navigation and heading focus without
  incrementing reviewed or delivered work.
- Keyboard preview → explicit review → apply; focus returns to the input.
- Unconfirmed save shows uncertainty and reload, with no retry/discard claim.
- Draft text survives task switches; a collapsed agreement error remains visible
  with a return-to-task action.
- At a 390px viewport, tested live, guide and review views have no horizontal
  document overflow; the note comparison stacks. Desktop comparison also checked.
- No browser console errors observed on the two tested preview tabs.

Fixtures: `/dev/mind-workspace` and `/dev/mind-review` with
`NODE_ENV=development` and `MIND_WORKSPACE_PREVIEW=true`. Both are unavailable in
production. The preview guard has regression tests. These checks are not a full
screen-reader/zoom/accessibility audit or an authenticated end-to-end journey.
No full production web build, database concurrency test, real provider/audio run,
deployment or hosted end-to-end check was performed for this new batch.

## External work remains

Qualified clinical review, content rights/editions, observed psychologist
acceptance, real-device/audio testing and exact release approval are separate
gates. Existing draft guides do not become complete reviewed protocols through
this interface work. Full historical source attribution and intervention
timeline storage remain separately scoped engineering, not implied by this UI.

The next release-facing step is authenticated preview testing of this exact new
candidate. The previously prepared test account remains pending activation;
the rejected account/capability write was not retried. Its separate exact-scope
authorization is still needed. Older PR checks and preview migrations do not
verify the new uncommitted UI batch.
