# Mind release validation

Owner checklist, 7 September 2026. Code and mocked tests are not proof of a
production-ready clinical product. Record the tested commit, environment, tester,
date and result for each release. Do not use patient records for these checks.

## What exists versus what is unverified

| Area                               | Code-observed facility                                                                                                                                         | Still requires evidence                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry, recording, notes and guides | Mind journey components, mocked route tests and isolated React browser harness                                                                                 | Real authenticated psychologist journey through consent, capture, note correction, signature, follow-up and sharing                                  |
| Record durability                  | Capture recovery/upload checks and note-version protection; no full live-audio backup                                                                          | Refresh/crash/offline recovery on real devices, including honest disclosure of untranscribed or missing audio                                        |
| Manual-note recovery               | Separate encrypted checkpoints, revision-bound autosave, atomic canonical apply/discard and signing guard                                                      | Authenticated web/database/KMS integration and competing edits on real devices; only server-acknowledged checkpoints are recoverable                 |
| External deletion                  | Locally implemented: Postgres-only rows avoid empty object tasks; S3 configuration is loaded only for actual legacy S3 deletion work; failures stay unresolved | Deployed worker configuration and authorized reconciliation of existing legacy tasks; never guess region/bucket or mark an unresolved object deleted |
| Service integration                | Disposable Postgres CI plus guarded NestJS integration suites                                                                                                  | These scaffold services use bypass auth and are not the deployed `apps/web` authenticated journey                                                    |
| Clinical content                   | AI draft guides and a small instrument registry                                                                                                                | Qualified clinician approval, evidence/source review, exclusions, language validation and licensing review                                           |

For implementation details and earlier evidence, see
[Mind journey hardening](MIND_JOURNEY_HARDENING.md) and the
[current UX follow-up](MIND_UX_FOLLOWUP.md). Keep local checks, GitHub merge,
deployment, migration application and production verification as separate statuses.

### Local follow-up implementation and evidence boundary

Manual editing now has a separate `NoteEditRecovery` checkpoint containing only
encrypted clinical field values: four SOAP fields or eight intake fields. It has
its own revision and canonical base version; autosave does **not** change
`NoteDraft.updatedAt` or make the checkpoint a signed/canonical note. There is no
plaintext clinical-field persistence in browser storage.

Apply corrections sends both `expectedUpdatedAt` and `expectedRecoveryRevision`.
Under the shared active-client lock, applying the note and clearing the matching
checkpoint are atomic. A revisioned tombstone prevents delayed autosave requests
from resurrecting discarded/applied edits. Signing refuses non-null unapplied
recovery: the psychologist must open Edit note and apply or discard it.
Stale checkpoints require explicit review, not automatic application.

Only a **server-acknowledged** editing checkpoint is recoverable. Unacknowledged
or offline edits, including the latest typed words, are not guaranteed to survive
a crash, Back navigation or component unmount. A saving indicator is not an
acknowledgement. This also makes no claim of lossless audio recovery.

The follow-up adds one additive migration,
[`20260926000400_mind_note_edit_recovery`](../prisma/migrations/20260926000400_mind_note_edit_recovery/migration.sql),
which was **unapplied during local verification**. The owner subsequently approved
the normal PR/merge and automatic web/migration release path; verify deployment
logs separately for the actual application result. Local contracts, server-route adapters,
signing/erasure guards and migration-idempotency checks have passed. The route
tests use synthetic records, a simulated transaction/PHI lock and mocked crypto;
they do not establish real PostgreSQL locking, deployed KMS or runtime readiness.
These are local working-tree results; rerun and record the release commit before
using them as release evidence.

The DPDP follow-up is also local code/test evidence, not a live configuration fix:
an empty object outbox or Postgres-only audio must not require S3 settings. Actual
legacy S3 work lazily requires explicit configuration; missing configuration and
unsupported legacy references remain unresolved. No region, bucket, credentials
or deployed deletion task was changed or verified by these checks.

### UX follow-up verification recorded on 7 September 2026

This is the latest local working-tree snapshot, not a new release commit.

- Web: 174 files / 1,322 tests passed. Contracts: 32 files / 359 tests passed.
- Gateway: 18 files / 198 tests passed, including ordered input, pause tails,
  authority expiry/revocation, shutdown behavior and resumed timing/limits.
  Local loopback tests and simulated provider/verifier responses are not deployed
  gateway evidence. The 42 focused web capture regressions also passed.
- Browser: 27 entry/editor/closeout, 13 recovery, five exact-start/client-switch,
  seven guide/ICD, six capture-control and two styled note-layout cases passed
  (60 isolated checks total). Real components are exercised; API/device/storage
  boundaries are simulated. The styled checks use application CSS at 390px and
  1440px; screenshots were inspected. Mobile hardware/keyboard remain untested.
- Uncached lint/type checks passed across all 19 projects. Changed editor and
  closeout components also passed explicit lint. Follow-up web typecheck passed
  without the incremental cache.
- Prisma schema and formatting checks passed; eight migration-tool tests and the
  replay-safe DDL check passed. No migration was applied.
- Independent bounded review found no additional high-priority save/sign issue;
  it is not a security guarantee or clinical certification.

See [the change map and remaining release gates](MIND_UX_FOLLOWUP.md). Browser
scripts are not yet an authenticated end-to-end CI suite. Runtime deployment,
real-device capture, clinical review and the isolated authenticated journey
remain separate gates.

### Earlier recovery baseline recorded on 7 September 2026

Working branch: `codex/mind-recovery-followup`, based on `d1106f1`. At this earlier
verification snapshot the changes were uncommitted and unpushed, not merged or
deployed. This section records historical test evidence, not current release status.

- Web: 168 files / 1,259 tests passed, including 16 recovery-client tests.
- Contracts: 359 tests passed. Gateway: 183 tests passed; the seven previously
  timing-sensitive transcript tests also passed ten consecutive focused runs.
- Browser: 20 existing journey regressions and nine new recovery journeys passed
  using fictional data with intercepted requests. No real sign-in was exercised.
- Destructive-database guard: 32 no-database unit/wiring tests passed.
- Uncached lint and type checks passed across all 19 projects. Changed editor
  components also passed explicit lint; Prisma schema/format validation and eight
  migration utility tests plus the replay-safe DDL check passed.
- Independent recovery review and 55 scoped server tests found no additional
  critical/high issue. This is bounded review evidence, not a security guarantee.

No migration, seed, real database integration suite, production deletion cron or
outbound patient communication was run. The untouched owner sprint document is
not part of this implementation batch. Human/isolated-environment gates below
remain open.

## Safe checks without a database

Use the repository's installed Node 22/pnpm 10 runtime. These commands exercise
synthetic fixtures; they do not establish real authentication or delivery.

```sh
pnpm exec prisma generate
pnpm --filter @cureocity/contracts build
pnpm --filter @cureocity/contracts exec vitest run src/note-edit-recovery.spec.ts
pnpm --filter @cureocity/web exec vitest run lib/note-edit-recovery-route.spec.ts lib/note-edit-recovery-schema.spec.ts lib/manual-note-save-route.spec.ts lib/medical-signing-route-behavior.spec.ts lib/dpdp-erasure-appointment.spec.ts
pnpm db:check-migrations
RUN_INTEGRATION_TESTS=0 pnpm --filter @cureocity/patient-model-service exec vitest run test/disposable-database.spec.ts
RUN_INTEGRATION_TESTS=0 pnpm --filter @cureocity/web exec vitest run lib/dpdp-object-storage-config.spec.ts lib/dpdp-object-deletion-route.spec.ts lib/dpdp-object-deletion-worker.spec.ts
node scripts/test-mind-entry-browser.mjs
node scripts/test-mind-note-recovery-browser.mjs
node scripts/test-mind-start-browser.mjs
node scripts/test-mind-guide-icd-browser.mjs
node scripts/test-mind-capture-browser.mjs
node scripts/test-mind-note-layout-browser.mjs
```

Prisma generation and migration-idempotency checks above do not apply migrations
or connect to a database. Do not substitute a migration or seed command.

The browser harnesses require the already-installed test Chromium and bundle
actual React components with intercepted APIs and blocked external requests.
They are manual commands, not part of `pnpm test` or the current GitHub workflow.
The note-recovery harness uses the actual note-editor components with fictional
data and an in-process server simulation; it is not the authenticated app or a
real database/KMS test. Its original nine journeys passed locally on 7 September 2026,
including reload, tab close, Back, lost responses, two-tab conflict resolution,
stale comparison, canonical apply and failure recovery. Rerun against the final
release commit and record its result separately. The
[fictional workspace preview](MIND_PSYCHOLOGIST_WORKSPACE.md) is another visual
check, not a real recording/signing environment.

The current UX follow-up extends recovery coverage to safe Close, lost discard
acknowledgement and Chromium same-document Back cancellation. Entry, guide/ICD,
capture-control and styled note-layout harnesses are separate checks. Capture
browser fixtures mock the devices, transport and API; gateway tests exercise
server behavior separately. They are not proof that a deployed browser and
gateway work together with a physical microphone.

Live pause requires a separately deployed pause-capable gateway. An older
gateway must show capture-off/pause-unconfirmed, never a false confirmation.
Resume rechecks current authorization and replays only acknowledged transcript;
test paused token expiry, consent withdrawal, server shutdown, interrupted tail
processing and explicit End after pause. Neither pause mode is a claim of
lossless audio recovery. Do not mistake web deployment for gateway rollout.

In a Codex git worktree, Nx may share its default cache with the main checkout.
Use the supported overrides to keep all validation artifacts in this worktree:

```sh
MIND_VALIDATION_ROOT="$(git rev-parse --show-toplevel)"
export NX_WORKSPACE_ROOT_PATH="$MIND_VALIDATION_ROOT"
export NX_WORKSPACE_DATA_DIRECTORY="$MIND_VALIDATION_ROOT/.nx/workspace-data"
export NX_CACHE_DIRECTORY="$MIND_VALIDATION_ROOT/.nx/cache"
export NX_DAEMON=false NX_ISOLATE_PLUGINS=false
pnpm lint --skip-nx-cache --output-style=static
pnpm typecheck --skip-nx-cache --output-style=static
```

## Destructive service integration: isolated database only

- [ ] Provision and independently verify a disposable **local** Postgres server
      and database named exactly `cureocity_mind_test`. A loopback URL can still
      point through a tunnel; do not tunnel it to production or shared data.
- [ ] Use a clean test process/environment. The guard requires
      `RUN_INTEGRATION_TESTS=1`, nonproduction mode, a PostgreSQL URL and exactly
      `localhost` or `127.0.0.1`. It rejects remote/ambiguous configured aliases:
      `DATABASE_RUNTIME_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`,
      `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`. There is no override flag.
- [ ] Do not load production `.env` files. Do not run `prisma/seed.ts`, legacy
      `scripts/e2e-demo.ts` or `scripts/load-test.ts` as a shortcut: they are not
      guarded proof of the requested authenticated Mind journey.
- [ ] Follow the disposable job in [CI](../.github/workflows/ci.yml): generate
      Prisma, reconcile historical fresh-CI migration ordering, apply migrations,
      build contracts, then run tests. The reconciliation helper additionally
      requires `CI=true`; never use it against an existing database.
- [ ] Understand that the two service suites delete whole tables before each
      test. They validate the environment before connection and again before
      deletion, pin the real Prisma clients to the checked URL, and retain their
      shared advisory lock. The guard does **not** make other scripts safe.

No database-backed suite or migration is run merely by adding this checklist or
running its guard unit tests.

## Real authenticated fictional Mind journey: prerequisites and acceptance

- [ ] Isolated web database, migration/runtime roles, encryption test keys,
      gateway, storage and queues; control every database URL alias. No production
      credentials or patient objects. Service `STORAGE_BACKEND=memory` does not
      select an in-memory backend for `apps/web`.
- [ ] Isolated Firebase project/test identities and real browser session-cookie
      creation, with `AUTH_BYPASS` off. There is no wired authenticated browser
      suite or Firebase emulator facility established by the current inventory.
- [ ] Deterministic synthetic audio/model fixtures; an explicit separate test
      for real gateway/model behavior. Measure audio-to-visible-text latency,
      not only server processing time.
- [ ] Outbound email/WhatsApp/push blocked or replaced with test-only sinks.
      Existing credentials can select real delivery backends even in development.
      Use fictional contact data; never send a test artifact to a real patient.
- [ ] Exercise psychologist sign-in → create/select client → consent → prepare →
      live/record-only capture → recover/retry → review/correct → sign → reopen and
      re-sign → next appointment → preview/share/revoke. Confirm the intended
      client and current canonical note throughout. Test cross-tenant denial and
      no recording, signing or sending without the relevant explicit action.
- [ ] Verify signing credentials where applicable; conflicts must not overwrite
      another version. Confirm saved corrections after reload, lost-network
      recovery, truthful saving/error cues and that guide markers never record
      therapy delivery.
- [ ] Store a redacted test report and screenshots. Do not retain audio, note
      text, tokens or secrets in CI logs. Stop if isolation is uncertain.

## Actual-device matrix — record pass/fail, not assumptions

| Device/browser                | Input and interruption cases                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows or macOS, Chrome/Edge | Built-in, USB and Bluetooth microphones; device switch/disconnect, denied/revoked permission, muted input, offline/reconnect, reload and tab close |
| macOS Safari                  | Permission flow, Bluetooth changes, background tab, sleep/wake, interrupted recording and saved-note recovery                                      |
| iPhone/iPad Safari            | Lock/background/foreground, incoming-call interruption, route changes, permission denial, intermittent network, narrow-screen note editing         |
| Android Chrome                | Headset unplug/Bluetooth disconnect, app backgrounding, network change, low storage and recovery                                                   |

On each supported device, inspect keyboard/focus and readable error states where
applicable, verify server-acknowledged audio versus pending local data, check the
last captured words after stop/retry, and record whether any gap is disclosed.
Missing audio must never be represented as recovered. No full device matrix or
accessibility certification has been completed by source inspection.

## Clinical content inventory and human release gate

Code inspection only: [PlanOfCareTab](../apps/web/components/app/PlanOfCareTab.tsx)
lists ten draft-guide choices, including cognitive restructuring, behavioural
activation, graded exposure, mindfulness-based cognitive therapy, acceptance and
commitment therapy, problem-solving therapy, sleep hygiene/stimulus control, two
EMDR phase labels and motivational interviewing. These labels are **not** evidence
of approved complete protocols or a recommendation to deliver those interventions.

The [instrument registry](../packages/clinical/src/instruments/index.ts) contains
PHQ-9 and GAD-7, with English item text. Optional language fields are not proof of
validated translations or broader questionnaire coverage.

- [ ] Qualified psychologists review supported use cases, suitability/exclusions,
      safety/escalation behavior and clinician-control boundaries.
- [ ] Named reviewers approve the actual guide content, evidence/source versions,
      instrument licensing and validated translations before release claims.
- [ ] Run a consented, supervised usability/quality pilot only after technical
      isolation and safety gates pass; document unresolved limitations.

The owner coordinates release evidence. Clinical judgment and clinical sign-off
remain with qualified humans; passing tests does not provide clinical certification.
