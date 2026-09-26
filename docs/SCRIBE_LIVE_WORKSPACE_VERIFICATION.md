# Scribe live workspace: local verification

## Scope

Doctor-only live consultation improvements. The existing therapist workflow is not redesigned.
This is local implementation evidence, not a production release or clinical validation.
Existing unrelated worktree changes and migration files were preserved; no migration was run.

## Implemented

- Transcript and encounter note are the primary workspace. Prescription and copilot use keyboard-accessible tabs.
- Sticky recording controls include patient context, measured microphone input, transcript freshness, explicit Pause/Resume, End, and an urgent-item action.
- Pause and End stop the physical capture, drain tail frames, and wait for gateway acknowledgement or finalization. Failed or unconfirmed capture is marked incomplete. Resume requires fresh authorization and gateway readiness.
- Recovered drafts and gateway timeouts/ASR loss carry persistent incomplete-capture metadata. Ordinary re-ingestion and note generation cannot silently clear it.
- Signing an incomplete capture requires an explicit clinician review bound to the current source draft and exact corrected note. Source/Rx/note changes invalidate review. Missing or unavailable source checks fail closed.
- Saving must complete before the review/prescription surface mounts. A failed-save retry retains the original medication and order payload.
- Differential labels are qualitative AI suggestions, not fixed probability bars. Asked/Dismiss and evidence actions are visible and touch-sized.

## Automated verification

- Final full web suite passed: 2,537 tests, 37 database-dependent tests skipped.
- Full contracts suite passed: 516 tests.
- Full live-gateway suite passed: 323 tests, including bounded finalization, ASR failure, and incomplete-result behavior.
- Web typecheck and scoped lint passed. Gateway typecheck/lint and whitespace checks passed.
- Scribe lifecycle regressions exercise microphone interruption, pause acknowledgement, disconnects during pause, End/drain order, incomplete salvage, automatic finalization, and cancellation of pending microphone startup.
- Twelve review-surface tests exercise loading/error states, explicit source review, note/Rx invalidation, failed-signature refresh, and stale transcript-response races.

## Visual verification

The development-only `/dev/scribe-live` fixture uses actual presentational components with fictional data. It does not mount live capture, request microphone access, open a socket, or access the database.
It is available only when `NODE_ENV=development` and `SCRIBE_WORKSPACE_PREVIEW=true`.

Checked desktop and 390px layouts, prescription/copilot switching, arrow-key navigation, sticky controls, no horizontal overflow, and visible controls at least 44px tall. No browser warning/error was reported on this fixture.

## Remaining release gates

- Run authenticated end-to-end sessions against a matching web and gateway build, with a prepared test database. Unit tests and a presentational fixture do not establish this.
- Test real microphone/device behavior: permission denial, unplugging, silence, Bluetooth changes, network loss, Pause/Resume, and speech immediately before End.
- Verify incomplete-draft reload, correction, prescription changes, review, and signing with fictional encounters before a clinician-supervised pilot.
- Obtain qualified clinician review of transcription and note accuracy, including the intended language mix.
- Verify exact release targets and obtain authorization before commit/push/merge, migrations, or deployment. Web and live-gateway releases are separate surfaces; neither was deployed here.
- The local Node runtime is 22.22.3, below the repository's declared 22.23.2 minimum. Repeat release validation on the declared runtime.
