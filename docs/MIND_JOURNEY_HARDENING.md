# Mind journey hardening

Implementation branch: `codex/mind-journey-hardening`, based on main
`067981a41c2cb6ab2172440b0e03301a1df92856`. Verification below is a local snapshot,
not a claim about GitHub merge, deployment, production migrations or clinical
certification. The initial implementation stayed local; merge preparation is
recorded separately below and in the task/PR status.

## Scope and visual plan

Fix the 6 September 2026 journey audit while preserving Mind for psychologists and
Scribe for doctors. Preserve the separate, existing `MIND_SCRIBE_DELIVERY_SPRINTS.md`.

Keep the established palette: paper `#f4f5fc`, white `#ffffff`, ink `#232339`,
violet `#6659c9`, caution `#fff4d9`, success `#d8eddf`. Existing serif headings
identify the client/current task; existing sans-serif supports readable controls.
Left-aligned content, one primary action, larger live controls, restrained motion.

The memorable element is the current conversation/guide step, not a dashboard of
competing panels. Safety remains outside optional disclosures. Navigation through
a guide never means an intervention was delivered.

```text
Prepare              Session                       Review & Close
Client + changes  -> Verified capture + one cue  -> Accurate note + decisions
Agreed focus         Optional evidence/details     Signature + next appointment
```

## Implementation workstreams

- [x] Entry: explicit client selection, repeat booking, appointment receipts and
      failure handling, inline new-client return paths, consistent capture defaults,
      identity-first overview and truthful last/signed labels.
- [x] Capture: durable finalization boundary, running-session resume, encrypted
      live-prefix handoff, acknowledged uploads, retry exhaustion, failed final flush,
      microphone cleanup/device failure and microphone-free generation retry.
- [x] Records: authoritative edited note, explicit-save/navigation protection, version-bound
      idempotent plan suggestions, independent agreements, historical decisions,
      real transcript processing states, consistent signed/closed terminology.
- [x] Guidance: one ordinary cue at a time, optional further questions, larger
      controls, recommendation rationale/evidence at selection, honest guide suitability
      and questionnaire coverage, clearer generation/error/navigation wording.
- [x] Review new code, run focused and full checks, inspect fictional UI.

## Important behavior changes

- Scheduling never silently substitutes a hidden client. General scheduling can
  be used repeatedly; closeout fixes the client and shows the actual appointment.
- Manual note correction edits the authoritative clinical fields. Older generated
  summaries/templates and stale evidence projections are invalidated. Saving
  checks the draft version; it does not silently overwrite a newer draft.
- Plan suggestions reference an immutable base plan and report revision. Accepted
  indexes are durable and repeat requests are idempotent. Conflicting or stale
  suggestions fail closed. Older reports without a bound plan need regeneration.
- A live-to-record-only handoff saves the captured transcript to encrypted server
  storage before navigation. Generation combines this prefix with subsequent
  recorded audio once. **Words not yet transcribed cannot be recovered by this
  transcript-only mechanism.** It is not a full live-audio backup.
- Unsent audio cannot be bypassed with **End anyway**. A missing final worklet
  acknowledgement is recorded in the local recovery cursor and blocks automatic
  finalization across retry/reopening. Known audio remains available to save;
  missing audio requires manual reconciliation, not a claim that retry restored it.
- Agreements are independent of AI availability. Post-sign additions are separate
  care decisions, not alterations to the signature or automatic client messages.
- Historical next-session-question receipts are separate from the current queue.
  Migration backfill only preserves available history; it cannot reconstruct
  questions already removed before this change.
- Guide selection carries into the session. Review navigation has acknowledged,
  revision-checked persistence; another view cannot silently overwrite newer
  progress. These markers never mean therapy was delivered or homework assigned.
- Quiet stays the default. Guided shows one ordinary question or selected guide;
  all safety cues remain visible. Recommendation rationale and AI evidence are
  available at the point of choosing an approach.

## Remaining implementation and validation work

1. **Crash-safe draft autosave is not implemented.** The editor still requires
   **Save note**. It warns on in-app links, reload/close and Cancel, and provides
   an inline transcript. Browser Back or a crash before saving can still lose
   unsaved edits. Do not advertise automatic saving or complete lost-work safety.
   Next implementation: revision-checked server draft autosave with recovery,
   failure visibility and browser-history tests; no plaintext PHI browser storage.
2. Verify the three additive `20260926...` migrations in disposable CI and the
   authorized deployment build logs. Local validation did not connect to a DB;
   the existing Vercel build applies migrations before building the app. A fully
   authenticated isolated staging journey remains a separate validation gate.
3. Run the authenticated fictional-client end-to-end journey, including signing,
   follow-up and sharing boundaries. Local mocked checks do not prove production
   authentication, deployed gateway behavior, database concurrency or delivery.
4. Complete the clinical/content and real-device release gates below. AI-drafted
   guides and current instruments are not a comprehensive approved therapy library.

## Required tests

- Client A selected, search B, selection/payload cannot disagree; repeated booking
  and failed skip retain actionable controls.
- Edited facts remain consistent across every signed representation; navigation
  does not silently discard corrections; transcript progresses without false failure.
- Sequential plan changes cannot target shifted goals, repeat or overwrite a stale
  plan; agreement and historical closeout remain accurate after later sessions.
- Leaving finalization before durable acknowledgement is guarded; resume reuses the
  actual lifecycle; prefix survives mode switch and generation retry exactly once.
- Upload counts reflect server acknowledgement; exhausted retry can recover; quota
  failure at stop cannot silently finalize; failed startup and device-ended events
  release/stop capture and report its real state.
- Quiet and selected-guide focus preserve all safety cues while only disclosed
  ordinary suggestions produce shown events. Scribe navigation and auth stay intact.

## External release gates (cannot be certified by code changes)

- Qualified psychologist approval of supported protocols, suitability/exclusions,
  evidence/source versions, licensing and instrument translations.
- Owner decision on eligible practitioner categories/credential requirements.
- Isolated authenticated staging journey, actual microphones/Bluetooth/mobile
  interruption testing, real deployed gateway failure/load drill.
- Clinical/model quality benchmark and psychologist usability pilot.

Do not call these gates complete from a passing typecheck, mocked test or preview.

## Verification on 6 September 2026

All commands used the existing Node 22.23.0 / pnpm 10.33 runtime. No dependency
installation or production service connection was needed.

| Check                                          | Result                                                |
| ---------------------------------------------- | ----------------------------------------------------- |
| Web Vitest suite                               | 1,194 passed / 164 files                              |
| Live gateway Vitest suite                      | 183 passed / 16 files                                 |
| Contracts Vitest suite                         | 345 passed / 31 files                                 |
| Audio package Vitest suite                     | 29 passed / 5 files                                   |
| LLM package mocked/unit suite                  | 124 passed / 15 files                                 |
| Clinical package suite                         | 284 passed / 24 files                                 |
| Migration replay/CI checks                     | 8 tests passed; replay-safe DDL check passed          |
| Isolated actual React/Chromium browser harness | 20 passed                                             |
| Web TypeScript                                 | Passed, no incremental cache                          |
| Full monorepo lint / TypeScript                | 19 projects passed each; 10 dependency builds passed  |
| Web app/lib and changed/new components ESLint  | Passed, zero warnings                                 |
| Contracts/audio TypeScript and ESLint          | Passed                                                |
| Prisma schema validation                       | Passed with a dummy local URL; no database connection |
| Git whitespace check                           | Passed                                                |

`node scripts/test-mind-entry-browser.mjs` passed all 20 checks in a final root-agent
rerun. It exercises actual React components in
isolated Chromium using fictional fixtures, mocked fetch, and blocked external
network. Coverage includes client selection/payload identity, repeated booking,
keyboard focus, errors, new-client return, Prepare retries/abort, guide hydration,
revision conflicts/timeouts/unmount, canonical correction payload, dirty/cancel/link
guards, required fields and transcript polling. It does not exercise the full
authenticated parent save/sign/database flow or physical microphones.

The current fictional local preview was also checked: Quiet retains safety cues;
Guided shows one primary ordinary question; suitability gates step navigation.
The safety action measured 44px high with 14px text at the current viewport.
No comprehensive accessibility certification or full responsive/device matrix is
implied. Gateway fake-socket tests needed local socket access; the isolated browser
needed permission to launch the already-installed Chromium.

## Merge preparation and release boundary

- Refreshed GitHub main remains `067981a`; no newer-main integration is needed.
- The browser harness is manually verified, **not run by the existing GitHub CI**.
  PR CI still needs to validate its normal format/lint/typecheck, disposable
  database migration/integration and gateway image jobs on the actual commit.
- Merge review found and addressed a stale recovery-prefix snapshot, stale live
  connection callbacks, active-client authorization for manual agreements, and
  conflicting duration/modality plan suggestions that could produce false receipts.
  Fresh full web tests pass after these fixes: 1,194 tests across 164 files.
  Narrow regression checks additionally prove delayed old-socket events cannot
  stop a newer microphone, erased clients cannot recreate agreements, and scalar
  plan conflicts cause no plan/receipt/audit mutation.
- **Do not assume a Git push/merge is deployment-free.** The verified Vercel
  production deployment of the base SHA was Git-triggered. `apps/web/vercel.json`
  runs `scripts/vercel-db-setup.sh`, which calls `prisma migrate deploy` on builds.
  The owner subsequently explicitly authorized this existing GitHub-to-Vercel
  deployment workflow and its configured migration step for these three reviewed
  migrations. No new environment variables are required by this batch. Do not
  disable branch protection or change deployment settings to bypass checks.
  Track commit, push, PR, merge, migration application and production deployment
  as distinct outcomes; stop further risky mutations on production failure.
- Pre-release runtime logs on base deployment `dpl_22wBB3PDP7u5sjPzceJ4vDE46p8Q`
  confirm an existing `/api/v1/cron/erasure-object-deletion` error: `S3_REGION` is
  missing. This batch does not repair that storage configuration. Do not describe
  production as fully healthy until the correct region is configured and the
  deletion worker is verified; never guess the production storage region.

### Rollback constraints

Before any release, record the exact merged SHA, base SHA, deployed version and
database migration state. These migrations add fields and an audit enum value;
do not drop columns, delete recovery content, or undo applied migration history as
an automatic rollback.

**A plain return to the previous application after new data exists is not an
erasure-safe rollback.** The previous erasure code does not clear the new recovery
ciphertext or historical-question snapshots. Use a reviewed feature rollback that
retains the expanded erasure behavior, compatible schema/client and audit enum
support. Preserve necessary security fixes and clinical records. A deployment
rollback and any database operation require separate explicit authorization;
a source-code revert alone does not establish production recovery.
