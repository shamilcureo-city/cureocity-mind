# Mind UI simplification implementation

9 September 2026. Local implementation of the owner's approved UI audit plan.

## Product boundary

Mind serves psychologists. Scribe's doctor workflow is preserved. The primary journey is prepare, conduct the session, review the note, then choose optional next steps. An AI suggestion is not a clinical decision; guide review is not therapy delivery; a saved draft is not a signature; signing is not sharing.

No new therapy protocols, assessment instruments, billing flows or autonomous clinical decisions are included. This work does not establish clinical readiness.

## Design direction, reviewed before implementation

Keep the existing Mind identity rather than replacing the visual system:

| Token          | Value     | Role                        |
| -------------- | --------- | --------------------------- |
| Lavender paper | `#f4f5fc` | Background                  |
| White          | `#ffffff` | Main work surface           |
| Ink            | `#232339` | Primary text                |
| Iris           | `#6659c9` | Primary action and focus    |
| Amber          | `#815600` | Actionable warning text     |
| Forest         | `#22734c` | Confirmed save/success text |

Fraunces carries client and page headings; Inter carries controls and body text. The client name is the distinctive focal point, not an oversized introduction or progress score. Clinical text remains left-aligned and readable. Keep line lengths bounded and secondary information available through labelled disclosures.

Layout comparison:

```text
Before                         After
Large introduction             Today / date
Progress banner                Current task / client
Client + long preparation      Short brief + Start
Long mixed attention list      Unfinished capture / action groups
Several completion boards      Note + contextual support
```

Session layout:

```text
Client and session identity
Capture state / time / Pause / End & save
Unresolved safety cues, if any
Quiet space                 [Open session support]
                            [Draft / transcript, on demand]
```

This is a working clinical interface, not a landing-page redesign. Retain the lavender/serif identity the owner already uses; remove repetitive cards, generic encouragement and decorative completion mechanics. Introduce no clinical points, streak pressure or additional navigation layers. Motion responds to actions and respects reduced-motion settings.

## Implementation workstreams

| Area                  | Scope                                                                                                                         | Status                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Trust and corrections | Accurate completion claims; acknowledged safety-cue review/correction; consistent agreements; honest draft/signed labels      | Implemented locally                                    |
| Find and start        | Task-first Today; historical unfinished-session recovery; grouped work/activity; compact preparation; responsive client pages | Implemented locally                                    |
| Calm capture          | Stable controls; timestamp-based clocks; quiet default; technical detail on demand; accessible end dialogs                    | Implemented locally                                    |
| Review and finish     | One note-first route with contextual support; optional next steps; safe saved-draft exit; separate sign/share                 | Implemented locally                                    |
| Verification          | Automated regressions, safe fictional preview, responsive/keyboard review, psychologist acceptance script                     | Local checks complete; clinician field testing pending |

## Verification and release boundaries

- Preserve the existing user-owned `docs/MIND_SCRIBE_DELIVERY_SPRINTS.md` without changes.
- Run focused behavior tests, web typechecking/lint and the relevant broader suites. Structural tests do not replace runtime behavior testing.
- Use the development-only `/dev/mind-workspace` fixture for visual and interaction checks. It must not mount capture, account mutation, clinical-save or sharing handlers. Its simulated states must be labelled as simulations.
- Test consent, denied microphone, live/standard capture, Pause/Resume, backgrounding, reconnect, long-session authorization, uploads, failed/uncertain saves and recovery separately in a suitable test environment with authorised fictional/consented audio.
- Check mobile/narrow windows, keyboard focus, Escape, zoom, reduced motion and contrast. Record exactly what was checked; do not claim blanket accessibility compliance.
- Ask 3–5 psychologists to complete the scripted tasks without coaching. A proposed target is four of five completing core tasks and all correctly identifying recording/saved/signed/shared states. This is an acceptance target, not a result.
- Commit, push, merge, database migration, website deployment, gateway rollout and live validation remain distinct steps. This local implementation does not authorise or perform a production release.

## Psychologist acceptance script

Use fictional clients only. Do not coach during a task. Ask the participant to think aloud and note wrong turns, uncertainty and interruption points.

1. Find the next booked client. Identify any historical unfinished session without assuming its microphone is currently running.
2. Prepare for a returning client and locate the last note. Start with unchanged preferences; confirm consent explicitly.
3. Conduct a counselling session without selecting a diagnosis, questionnaire or guide.
4. Choose a reviewed guide, move between steps, skip an irrelevant step and leave the guide. Explain what a checked review marker means.
5. Explain recording, paused, disconnected and saving states. Pause and resume using authorised test audio. Recover from a failed upload without starting a duplicate session.
6. Correct a draft against transcript evidence. Leave it saved but unsigned, then return and sign deliberately.
7. Record and correct an agreement. Distinguish a post-sign care-decision correction from changing the signed note.
8. Defer optional next steps. Schedule only if needed; preview a shared document without inferring that a created link was delivered.
9. Repeat key tasks with keyboard and a narrow viewport. Check focus is visible and not covered by a sticky action area.

Collect active documentation time and navigation errors against the same tasks in the existing product. Do not claim a time saving until measured. Do not place client names, note bodies, diagnosis text or transcript content in analytics.

## Completion ledger

### Local code coverage of the audit

| Audit concerns                         | Implemented behavior                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1–U2: misleading readiness            | Basic checks are not called clinical readiness; absence of AI gaps is not a completed assessment.                                                                                                                        |
| U3: silent safety-cue dismissal        | Review and Undo require an acknowledged save. Changed evidence reappears. History loading, failed saves and conflicts stay actionable; review never claims a safety assessment.                                          |
| U4–U5: old sessions and mixed queue    | Recent unfinished work and dated historical recovery remain accessible. Failures stay visible; ordinary actions and passive link activity are separated.                                                                 |
| U6–U7: preparation and client overload | Compact recap, optional detail/settings, explicit consent, provisional care suggestions, recent records and responsive roster rows.                                                                                      |
| U8: overlapping completion             | Note-first review with one contextual support area; agreements, scheduling, measures and sharing are optional, not mandatory completion hoops.                                                                           |
| U9: distracting capture                | Shared top capture controls for Mind, draft/transcript on demand, Quiet safety cues, honest view-clock and upload/connection state. Scribe retains its capture layout.                                                   |
| U10: corrections                       | Agreement corrections retain old wording and attribution. Signed-note content is unchanged; a post-sign care-decision amendment is explicit. Earlier follow-up stays in history and does not apply to corrected wording. |
| U11: narrow screens and keyboard       | Responsive roster, native recording-option radios, larger scoped controls, stronger secondary-text contrast, focus-trapped end dialogs.                                                                                  |
| U12–U13: stale state and counts        | Date-scoped intentions, timestamp-based view clocks, accurately labelled record counts and draft/signed map state.                                                                                                       |

### Browser evidence

The development-only fictional preview was exercised at desktop 1280×720 and phone 390×844. The roster and guide had document width equal to viewport width at 390 px. Checks covered disabled Start before simulated consent, Pause/Resume, interruption without false saved-state claims, cue failure/retry/history/Undo, a safe end-dialog initial focus, Tab/Shift+Tab wrap, Escape/focus restoration and draft-review handoff. Guide navigation required suitability review; moving to the next section without marking the prior section did not claim delivery. Browser error logs were empty when checked.

The preview reuses actual Today, roster, capture status bar, guide, copilot rail and readiness components. Preparation/review fixtures and capture/save transitions are deliberately simulated. This is not authenticated end-to-end evidence for the new API, signing, database history or audio transport.

### Release gate still open

The additive `20260926000500_mind_agreement_corrections` migration is prepared locally only. It adds agreement revision/history and stable creation-retry identity; it does not alter signed notes. No database was migrated. Existing agreement screens need that migration before running this code against a deployed database.

Before release: review the migration on a disposable database, run authenticated fictional-client creation/correction/signing/erasure/export tests, verify real-device audio and gateway Pause/Resume/recovery, then run the psychologist acceptance script above. Screen-reader, browser zoom and real reduced-motion behavior have not been certified. Commit, push, merge, deployment and live acceptance remain separate authorizations and checks.

### Automated verification

- Web regression suite: **188 files / 1,456 tests passed** (baseline: 176 / 1,364).
- Shared contracts: **33 files / 372 tests passed**; TypeScript compilation passed.
- Web ESLint includes `app`, `lib` **and `components`**; contracts ESLint passed.
- Prisma schema validation passed using a dummy local URL only (no connection or migration). Migration guard tests: **8 passed**; all new DDL passed the replay-safe check.
- Core Mind text/status-token contrast checks: **14 passed**, included in the web count. These are scoped token checks, not full WCAG certification.
- Independent cross-review corrected the agreement follow-up/retry and session-switch cue-state bugs; their regression tests are included above.

- Final web TypeScript check passed.
- Production Next.js build passed, including page generation and trace collection. The successful local command allowed public font downloads, used a 4 GB Node heap and disabled source-map uploads. It did **not** use the Vercel release script or run migrations. The first attempt hit sandbox font DNS restrictions and the default heap limit.
- Formatting checks passed for changed and new task files; the user's existing untracked sprint document was excluded. `git diff --check` passed.

Non-blocking existing build warnings remain for Next typed-routes configuration, Sentry configuration naming/deprecations, missing marketing `metadataBase`, and large webpack cache strings. They do not establish a runtime fault but should be cleaned up in a separate maintenance change.

### Screenshot follow-up: same-session consent recovery

The reported live-token failure was an incomplete session consent snapshot, not evidence that the client never consented. The previous recovery link discarded the session ID, and the existing entry flow could not repair an in-progress session. Raw scope names and “Writing…”/“Listening…” states also misrepresented the blocked capture state.

Implemented locally:

- Recover inside the exact session without discarding its held transcript or draft. Open-record navigation stays tied to that session and guards unsaved work.
- Explicit, initially unchecked confirmation of the three required permissions. Recovery applies prospectively and preserves previous acknowledgements, notes, withdrawn/expired grants and optional retention history.
- The new Mind-only endpoint verifies practitioner capabilities, active-client ownership, lifecycle and signature state under client/session locks. Revision checks reject stale consent; a stable operation receipt makes lost-response retry safe without silently regranting after withdrawal, expiry or correction.
- Saving does not open the microphone, mint a live token or activate the session. Acknowledgement returns to Start/Resume controls, with keyboard focus restored; the ordinary capture authorization checks still run on the next explicit start.
- Consent blockage now says capture is off; empty draft/transcript displays no longer imply ongoing writing or listening. Other lifecycle conflicts no longer open the consent form.
- The UX-copy and code-review skills informed plain-language recovery copy, explicit save-versus-recording boundaries and the retry/authorization checks. An independent review caught an incompatible script-version format before completion; the `v1.1` value is now tested against the actual shared contract.

Verification: the final full web suite passed **191 files / 1,520 tests**, including 38 new route cases, 18 client/status cases, five form-handler tests and the retained-draft/transcript lifecycle regression. Typecheck, full web/component lint and task-file formatting passed. The local production build passed without migrations or source-map uploads; a subsequent preview-only status-label correction passed typecheck, lint, development compilation and the final suite. Browser checks exercised the actual recovery form with a complete no-network transport at 1280×720 and 390×844: all unchecked, disabled Save, lost reply, retained selections, retry success and keyboard-only selection/save; no horizontal overflow, and tested focus stayed below the sticky capture bar. Error logs were empty when checked.

Limits: browser saves were explicitly fictional, with no API, consent, database or microphone mutation. Database serialization/rollback is covered by mocks, not real PostgreSQL concurrency. Authenticated end-to-end consent capture and real-device recording remain separate release checks. This follow-up adds no migration and makes no Scribe or gateway changes; the earlier agreement migration above is still unapplied. No commit, push, merge or deployment was performed.

### 10 September: isolated PostgreSQL validation

This follow-up closes the **local real-database** gap above, not the production, Firebase-authenticated HTTP or real-device/gateway acceptance gates. The testing-strategy skill separated transaction integration coverage from component simulations and physical-device checks.

Added `apps/web/lib/mind-consent-recovery-postgres.spec.ts`, opt-in only with `RUN_MIND_POSTGRES_TESTS=1` and an explicit `MIND_TEST_DATABASE_URL`. Its target guard requires PostgreSQL on `127.0.0.1:55439/cureocity_mind_test`, rejects caller-supplied query/socket/schema overrides and never falls back to application database URLs. Ordinary runs skip the nine database cases while running the twelve target-guard checks.

| Area                                  | Test type and evidence                                              | Result / remaining boundary                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Consent/history preservation          | Actual route handlers, Prisma persistence and audit rows            | Passed; prospective timestamps, previous snapshot/grants and held draft preserved           |
| Concurrent recovery                   | Real PostgreSQL transactions, identical and different operation IDs | Passed; one commit for duplicate retries, stale competing request rejected                  |
| Withdrawal/erasure/lifecycle          | Actual Client/Session lock waits observed with `pg_blocking_pids`   | Passed; mutation winning the lock prevents stale recovery                                   |
| Uncertain save after withdrawal       | Committed recovery, withdrawal, then same-operation retry           | Passed; no silent regrant                                                                   |
| Atomic audit failure                  | Fixture-scoped PostgreSQL trigger rejects final audit insert        | Passed; snapshot, new grants and earlier audits roll back together                          |
| Scheduled recording boundary          | Consent save on a scheduled fixture                                 | Passed; no lifecycle start                                                                  |
| Capture controls/media lifecycle      | Existing mocked capture, renewal, preflight and recovery suites     | Passed as simulations; real microphone, AudioWorklet, gateway and latency remain unverified |
| Authentication and production DB role | Identity/capability and telemetry stubbed for integration suite     | Not proven by these tests; no live credentials, KMS or notification/AI services used        |

Results: **192 web files / 1,541 tests passed**, with the integration flag enabled: **9 real PostgreSQL cases + 12 target guards** are included in that total. New test typecheck, lint, formatting and whitespace checks passed. No application code, shared dependency or lockfile changed in this validation turn. The new test fixtures honor the existing one-demo-client-per-practitioner database constraint.

Isolation: Docker did not respond, so a pinned PostgreSQL 16.14 binary was installed only under `/private/tmp/mind-postgres-validation.qKsCRs` from the [embedded PostgreSQL npm package](https://www.npmjs.com/package/@embedded-postgres/darwin-arm64). A fresh cluster used password authentication and listened only on loopback port 55439. The 139 file-backed migrations were reconciled/applied using the repository's existing fresh-CI procedure for the known historical booking-order seam. Two empty, untracked local directories (`20260906123000_mind_recovery_transcript` and `20260906140000_mind_closeout_integrity`) caused an initial local P3015; only their copies were excluded from a temporary schema snapshot. Original workspace folders and migration SQL were untouched. The agreement correction migration applied and replayed successfully **in the disposable database only**.

#### Separate release blocker found: reminder duplicate-prevention index

The migrated database does not have the schema-required unique index on `(appointmentId, scheduledStartAt, kind, recipient)`. This is a pre-existing issue, not introduced by the UI/consent work:

- `prisma/migrations/20260917000000_appointment_reminder_schedule_version/migration.sql:35` names the old index with a 71-character identifier.
- `prisma/migrations/20260920000000_appointment_reminder_recipient_delivery/migration.sql:57–60` uses an 81-character replacement name, then drops the old name. Both truncate to the same 63-character PostgreSQL name, so creation is skipped and the existing index is removed.
- Actual `pg_indexes` inspection after both migrations completed showed only the primary key and status/lease index. A transaction-scoped reproduction inserted **two** same-identity reminder rows with `createMany({ skipDuplicates: true })`, where one was expected. The probe was rolled back and no provider was called.
- `apps/web/lib/appointment-reminder-outbox.ts:102` relies on this uniqueness for concurrent enqueue safety. Duplicate notifications are therefore a supported risk, not an observed production delivery incident. Production database state was not inspected.

Recommended next action: separately approve and implement a fix-forward migration with a short, explicit unique-index name and matching Prisma `map`, a duplicate-data preflight and a real PostgreSQL regression test. Do not rewrite applied migration history or silently delete existing delivery history. The other drift (legacy compatibility column/defaults and differing index names) does not explain this missing uniqueness. No reminder fix or production migration was performed during validation.

Before release, resolve that blocker, then perform authenticated fictional-client HTTP checks and authorized real-device/gateway capture testing. The disposable PostgreSQL server was stopped after verification; fictional fixture data and the temporary test binaries remain in the named temporary directory. No commit, push, merge or deployment was performed.

### 10 September follow-up: reminder repair verified locally

The owner approved fixing the reminder migration. The preceding reminder blocker is now **repaired and verified in the isolated local database**, not in production. The fix-forward `20260926000600_reminder_delivery_uniqueness` migration and matching Prisma `map:` restore the four-part reminder identity with a short database index name. Applied historical migrations remain unchanged.

The migration locks out concurrent writers between inspection and installation, uses bounded timeouts, rejects existing duplicates or conflicting index definitions, and preserves every delivery record. No automatic deletion, reconciliation, retry or delivery-state changes are included. The read-only aggregate preflight and authorized rollout/recovery procedure are in `scripts/check-reminder-delivery-uniqueness.sql` and `docs/REMINDER_UNIQUENESS_REPAIR.md`.

Verification:

- The actual Prisma migration deploy applied the new migration on the disposable PostgreSQL 16.14 database; direct SQL replay passed. Its migration record is finished, and catalog inspection confirms the canonical valid/ready unique index on all four expected columns.
- A rollback-only probe against the actual migrated public table inserted **one** record for duplicate `createMany({ skipDuplicates: true })` input, compared with two before repair. Different recipient, reminder kind and schedule each remained insertable. No notification provider was invoked.
- **193 web files / 1,568 tests passed**, with real-database integration enabled. The 27 new reminder checks comprise 12 no-connection target guards and 15 real PostgreSQL cases, including concurrent native Prisma enqueue, observed writer-lock races, history preservation across all eight delivery statuses, index-shape rejection, safe replay and reproduction of the old name collision.
- The read-only preflight reported zero duplicate groups and the correct index shape on the migrated local database. Schema comparison no longer reports missing reminder uniqueness. It still reports previously identified compatibility-column/default and unrelated index-name differences; no blanket zero-drift claim is made.
- Prisma validation/client generation, full web TypeScript checking, web/component lint, formatting and whitespace checks passed. No package or lockfile changes were needed. This database/test-only follow-up did not rerun the earlier successful local production build.

The testing-strategy and code-review skills guided real-transaction regression coverage, bounded failure behavior, history preservation and independent review. A future-only migration guard also rejects index names exceeding 63 UTF-8 bytes in top-level literal DDL and DO blocks without changing applied files. Function bodies and dynamic SQL still require review. Independent cross-review caught and corrected a dollar-string parsing edge case; all **21 migration-command checks passed**, including its regressions and the repository guard.

Production database state is uninspected. Any existing production duplicates require separately authorized reconciliation, not deletion to pass deployment. Authenticated fictional-client HTTP checks and authorized real-device/gateway acceptance remain open. The disposable PostgreSQL server was stopped after verification, with fictional fixtures retained. No commit, push, merge, deployment or production migration was performed in this follow-up.
