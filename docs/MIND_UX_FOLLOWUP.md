# Mind UX follow-up — 7 September 2026

Scope: the owner's “fix all” request following the Mind UX review. This is a
local implementation record, not a claim that every possible UX issue or clinical
readiness gap has been eliminated. Mind remains psychologist-focused; Scribe's
doctor workflow is not redesigned.

## Journey changes

| Reported issue                                                | Implemented response                                                                                                                       | Main implementation                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Scheduled sessions opened review or looped back to Today      | Status-aware links open preparation, resume the exact session, or open its note                                                            | `lib/mind-session-start.ts`, Today and client session pages, `NotesTab` |
| Changing client retained the old booking/guide                | Client-scoped context resets; exact-booking validation cannot silently create a replacement session                                        | `RecordingShell`, `RecordConfirmStrip`, sessions POST                   |
| Custom ICD code disappeared or retained the old label         | Explicit “Use this code”; typing clears stale committed code/label and blur retains text                                                   | `Icd11Picker`, `PlanOfCareSheet`                                        |
| Agreement/homework text could disappear during navigation     | Unsaved-work warning, bounded requests, retained text on failure and duplicate-safe identical retries                                      | `MindSessionAgreements`, agreements POST                                |
| Slow/offline guide progress blocked reading                   | Reading position is independent of acknowledged review markers; navigation stays usable while writes wait or fail                          | `MindTherapyGuide`, `use-mind-guide-review`                             |
| Recovery failure trapped the editor or left signing available | Safe Close editor; recovery check gates sign and AI rewrites; discard has its own acknowledged retry                                       | `ClinicalFieldsEditor`, `NoteRecoveryNotice`, `NotesTab`                |
| Recording recovery promised more than it could guarantee      | Copy distinguishes captured/received material from audio that was never saved; fixed-time generation promises removed                      | `NotesTab`                                                              |
| No intentional pause/resume                                   | Input stops without ending the session; explicit resume rechecks current access/consent; live waits for correlated gateway acknowledgement | `LiveRecorder`, `TherapistLiveSession`, capture hooks, gateway          |
| Guide selection was late and mobile Start was buried          | Optional existing-guide selection before capture; visible live Start in the header                                                         | `RecordConfirmStrip`, session defaults route, `TherapistLiveSession`    |
| Save/recovery/sign wording was confusing                      | “Draft edits saved”, “Apply corrections”, “Close editor”, “Discard edits” describe different actions                                       | Note editing components                                                 |
| Long note editing required repeated scrolling                 | Field jump links, required-field focus, sticky actions and optional transcript reference beside editing                                    | `ClinicalFieldsEditor`, `NoteEditingLayout`                             |
| Closeout required tab switching                               | Clinical suggestions/questions can open within the finish checklist; no automatic acceptance/review and no duplicate signing surface       | `MindSessionCloseout`, `MindCloseoutDecisionActions`, `AICopilotTab`    |
| No recent clients made existing clients hard to find          | Existing client browsing remains available                                                                                                 | `ClientPicker`, `MindTodayWorkspace`                                    |
| Reopened notes were labelled signed in client history         | Session list uses authoritative lock/signature status                                                                                      | Client sessions page, `clientSessionSummary`                            |

Documentation-only accounts do not fetch or see the embedded clinical-analysis
surface. Merely opening a guide or clinical panel does not record therapy,
accept a diagnosis, mark a suggestion reviewed, sign a note or send anything.

## Design direction

Preserve the existing Mind visual system and controls. Keep the clinical task
left-aligned and primary; use disclosure for optional context. Wide screens can
show source transcript beside corrections; phones use a bounded reference pane
above the fields. Keep edit actions reachable while scrolling. No new dashboard,
points, competitive scoring or clinical auto-acceptance is introduced.

The design, UX-copy and testing skills informed progressive disclosure, distinct
save/apply/sign language, and failure-oriented regression coverage.

## Important boundaries

- Only server-acknowledged note checkpoints are recoverable after a crash. The
  latest offline/unacknowledged text is not guaranteed recoverable. Clinical
  fields are not persisted as plaintext in browser storage.
- Unsaved-work protection covers ordinary links and document unload. Chromium
  same-document Back is tested through the Navigation API. Other browsers may
  not offer cancellable same-document history navigation; no universal guarantee
  is made for browser termination or operating-system suspension.
- Batch pause releases recorder-owned input, flushes known frames and retains
  the session/chunk cursor. Resume rechecks ownership, capabilities, session state
  and current consent. Pausing external call capture stops owned clones, not the
  call's original tracks.
- Live pause stops new input and waits for the gateway to process ordered
  preceding audio. A confirmed pause is not a full audio backup or a saved
  canonical note. Keep the page open. Resume uses a fresh authorized socket and
  acknowledged transcript replay; it never renews old socket authority.
- Resumed live timing includes the acknowledged transcript timeline, so pause
  does not reset the duration ceiling or move therapy pacing back to the start.
- An old gateway or missing acknowledgement cannot be shown as confirmed paused.
  The screen warns that capture is off but the last audio is unconfirmed. A
  gateway shutdown does not implicitly end an intentionally paused session.
- This change does not establish real microphone compatibility, production
  transcription latency, clinical correctness, licensing or clinician approval.

## Release status and next gate

Branch: `codex/mind-recovery-followup`, base `d1106f1`. At local verification the
combined recovery/UX follow-up was uncommitted, unpushed, unmerged and undeployed,
and `20260926000400_mind_note_edit_recovery` was unapplied. Those are historical
test boundaries, not live release status. The owner subsequently authorized the
PR, checks, merge and automatic web deployment/database migration. Verify the
resulting commit, CI, deployment and migration logs separately. The standalone
live gateway deployment is not included in that authorization. The owner's
separate `MIND_SCRIBE_DELIVERY_SPRINTS.md` is untouched.

The migration adds a table without rewriting existing notes. Do not drop it on
rollback. Old `main` does not know about pending recovery when signing or erasing
data; after checkpoints exist, prefer a forward fix or a rollback retaining those
guards. A source-code revert alone is not a privacy-equivalent database rollback.

Before a release, confirm release authorization, review the combined diff and
migration, and test an isolated authenticated fictional session end to end.
Deploy the pause-capable standalone gateway separately from the web app and
verify the browser/server protocol together. Then run the actual microphone,
mobile/background, consent-revocation, reconnect and note-signing checks in
[Mind release validation](MIND_RELEASE_VALIDATION.md). A Vercel web deployment
alone is not evidence of a gateway rollout.
