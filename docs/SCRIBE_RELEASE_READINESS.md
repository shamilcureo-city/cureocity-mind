# Scribe integration and release-readiness checkpoint

## Authorized release preflight — 26 September 2026

The owner authorized merging to `main` and deployment after the checkpoint below.
This section supersedes its local-test results; it does not by itself record a completed release.

- Dedicated disposable PostgreSQL on localhost port 55440: all 152 migration records
  completed (151 migrations executed plus the documented fresh-CI historical booking
  reconciliation). A second deploy reported no pending migrations. Existing local and
  production databases were not used by these tests.
- Restricted runtime-role Scribe suite: **40 passed**, including all **21 real PostgreSQL
  cases** and 19 guard cases. No cases skipped in this dedicated run.
- Full web regression: **3,371 passed, 58 skipped**; the 21 Scribe cases skipped by that
  general run passed separately above. Contracts: **516 passed**. Gateway: **331 passed**
  and its build passed. Web TypeScript, repository lint, formatting and diff checks passed.
- Fixed an additional consent boundary: signed-instruction AI translation now carries its
  encounter identity and rechecks retained teleconsult consent during reservation, immediately
  before provider disclosure, and under the persistence lock. Withdrawal fails closed while
  deterministic source-language drafts remain available. The focused suite passed 107 tests.
- Verified release repository `shamilcureo-city/cureocity-mind`, PR 160, source branch
  `codex/scribe-opd-closeout`, and target `main` at `7b8bba2b7b5c53c16c3ff62bab552556310cfc5c`.
  Vercel target is the existing `cureocity-mind-web` project, not a new application.
- Existing preview configuration uses its preview database, mock AI and auth bypass; it is
  suitable for build/schema checks, not proof of real Firebase or clinical behavior.
  Production configuration remains Vertex, GCP KMS and the restricted `cureocity_runtime`
  role. Sensitive production credentials are withheld by Vercel's local environment export.
- `SCRIBE_TELECONSULT_ENABLED` and its link secret are absent in both environments, so
  teleconsult remains disabled. No rollout flag or cloud configuration was changed.
- Deploy **web first**, then the matching gateway: the old strict web authority schema
  rejects the new gateway's `purpose` field. New web accepts the older gateway protocol.
  Gateway changes require a separately staged immutable image, current rollback revision,
  readiness checks and a quiet traffic switch. Preserve all existing Cloud Run settings.
- Authenticated device testing, two-device teleconsult acceptance, real KMS/provider
  verification and clinician acceptance remain separate from a successful deployment.

## Earlier checkpoint: local validation, not a release

Checked 26 September 2026 in `codex/scribe-opd-closeout` at committed HEAD
`684a40427353197615bb87176e7d35b0f9e0f4c0`, plus the existing uncommitted Scribe milestones.
GitHub comparison confirmed that committed branch is one commit ahead of `main`
(`7b8bba2b7b5c53c16c3ff62bab552556310cfc5c`) and zero behind.
[PR 160](https://github.com/shamilcureo-city/cureocity-mind/pull/160) is open and unmerged.
Its Vercel status is successful for the older committed bundle, not for the uncommitted
workflow, teleconsult, coding, document and template additions. Production runtime state was
not inspected or changed.

The local protected page `/app/clinic/templates` returned HTTP 500 during the signed-in workflow
check. The server reported that no database connection string was configured. The fictional
`/dev/scribe-*` previews do not establish authenticated Firebase, real storage or KMS behavior.
No production credentials were loaded, no authentication setting was changed, and the existing
local infrastructure was not repurposed as a disposable test database.

## Database review

The five local migrations are an ordered chain:

| Migration                                      | Database effect                                                            | Required verification                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `20260928000000_scribe_doctor_workflow`        | Encrypted workspace table, scope/ownership/revision triggers, audit action | Ownership, lifecycle locks, CAS, patient erasure                     |
| `20260929000000_scribe_teleconsult`            | Encounter-only kind and one-call-per-session partial unique index          | Missing/cross-patient scope and duplicate-call refusal               |
| `20260930000000_scribe_coding`                 | Encounter-only kind and one-worksheet-per-session partial unique index     | Duplicate worksheet refusal and review persistence                   |
| `20261001000000_scribe_consultation_documents` | Encounter-only document packets                                            | Multiple packets, CAS and patient erasure                            |
| `20261002000000_scribe_doctor_templates`       | Private template kind with null patient/session scope                      | Runtime-role CRUD, operation retry after deletion, patient isolation |

Static inspection found no migration-breaking SQL defect. Each migration uses transaction and
lock/statement bounds; later constraints preserve earlier kinds. This is not proof of SQL
execution, full historical replay, existing-data compatibility or runtime-role grants. The
constraints acquire table locks and partial unique indexes require compatible existing data.
Keep schema changes separate from a clinical quiet-window release decision.

The earlier workflow-only disposable test used `db push` for other schema objects; it did not
validate the complete historical migration chain. The new isolated CI plan applies that chain,
using the existing narrowly gated historical-order reconciliation helper, and tests as a
non-owner runtime role rather than the migration owner. These tests intentionally stub tenant
crypto and identity: they cannot establish Firebase or real KMS correctness.

## Focused access review

Fixed locally: the new teleconsult server-rendered page now checks current active-practitioner
capabilities before reading or decrypting its patient header, rather than relying only on
onboarding/vertical routing. Its patient lookup requires an active, non-erased, doctor-owned
patient. Sixteen new rendered-page regression tests prove that inactive, revoked or unavailable
authorization never reaches the patient query or decryptor. The API guards remain independently
authoritative; this change does not certify real Firebase authentication.

Review dimensions:

- Security: new teleconsult header authorization was tightened locally; current API ownership and
  capability tests pass. This is a targeted review, not a security certification.
- Correctness: migration scope/revision conventions are coherent statically; actual PostgreSQL
  execution and multi-window authenticated use remain unverified in this checkpoint.
- Performance: bounded requests/libraries and migration lock timeouts exist; no load test or
  production query-plan measurement was performed.
- Maintainability: explicit preview transports and separate doctor routes preserve Mind's
  journey; dedicated PostgreSQL CI coverage prevents these cases from silently staying skipped.

Template deletion-retry protection relies on retaining the content-free delete audit; future
audit retention or redaction work must preserve that guarantee. Also verify explicit production
KMS configuration: the existing local-dev fallback guard in `tenant-crypto.ts` keys off
`VERCEL_ENV=production`, not every possible non-Vercel production environment. This is a
pre-existing conditional hardening concern, not evidence of a live misconfiguration here.

## Authenticated validation plan

Use an explicitly selected isolated staging environment, two fictional doctor tenants, a
therapist account and disposable fictional patient encounters. The operator signs in normally;
never use auth bypass as evidence of sign-in readiness. Never send passwords or OTPs in chat.

| Area                          | Test type and required evidence                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and product boundary | Browser + API: active doctor enters Scribe; therapist, inactive doctor and revoked capabilities cannot read the protected patient content                                   |
| Templates                     | Real persistence across reload/sign-out, two-window stale edits, deletion/retry, private tenant scope; no patient-to-template copying                                       |
| Source comparison             | Signed/source versions remain linked; unavailable evidence stays unavailable; source changes invalidate stale review                                                        |
| Coding                        | Doctor-reviewed persistence, stale-source refusal and duplicate worksheet constraints; no claim submission or assumed coding correctness                                    |
| Consultation documents        | Signed excerpts unchanged, append-only template application, incomplete-field review/download refusal, real reviewed-text download                                          |
| Privacy lifecycle             | Patient-specific export and approved erasure include clinical copies but exclude private templates; audit contains no clinical bodies                                       |
| Teleconsult                   | Two real devices, separate patient/doctor consent, both audio sources, mute/loss/rejoin, consent withdrawal, final-tail completeness and persisted incomplete-note handling |
| Mind regression               | Therapist sign-in and existing video/session review still function; no Scribe routes or medical outputs replace Mind's workflow                                             |

Coverage target: every authorization-denial case must stop before PHI access, every stale save
must fail visibly, and no template/source operation may silently change signed clinical text.
Clinician review of wording, source fidelity and usability remains separate from technical tests.

## Environment and release gates

1. Select the staging URL and fictional doctor account; configure its isolated database and
   normal Firebase client/admin configuration. Production uses a separate `DATABASE_RUNTIME_URL`
   and `DATABASE_RUNTIME_ROLE`; migrations use `DATABASE_URL_UNPOOLED` as the owner.
2. Run the new isolated PostgreSQL job, production build and existing web/contracts/gateway
   checks against the exact proposed revision. Confirm migration status and real KMS operation.
   Intended production KMS configuration is `KMS_BACKEND=gcp-kms`, `GCP_KMS_KEY_NAME` and working
   `GOOGLE_APPLICATION_CREDENTIALS_JSON`; preserve any required legacy key-unwrapping setup.
3. For teleconsult, explicitly configure `SCRIBE_TELECONSULT_ENABLED`, a strong independent
   `SCRIBE_TELECONSULT_LINK_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
   Match `NEXT_PUBLIC_LIVE_GATEWAY_URL`, shared gateway authorization configuration and
   `LIVE_AUTHZ_REVALIDATE_URL` with the compatible web/gateway versions. Keep teleconsult disabled
   until its two-device checks pass. Never copy production secrets into fixtures or logs.
4. Complete the authenticated matrix above and qualified clinician acceptance. Other new
   document/template/coding/source tools do not have equivalent standalone rollout switches;
   deploying their code exposes them to appropriately authorized doctors.
5. Review the local diff, then separately authorize commit/push/PR changes and deployment.
   **Vercel's configured build invokes `scripts/vercel-db-setup.sh`, which runs migrations even
   for preview builds when configured.** A preview is not automatically a safe database sandbox.
   Verify its exact target first. Web/database release and Cloud Run gateway release are separate.

No migrations, production configuration, commit, push, merge or deployment were performed during
this checkpoint. A healthy preview or CI status is not a claim of clinical readiness.

## Completed local checks

- Full web suite: **330 files passed; 3,362 tests passed, 58 skipped**. The skipped count includes
  **21 Scribe PostgreSQL cases**, intentionally not enabled without their dedicated database.
- Web TypeScript: `tsc --noEmit --incremental false` passed; Prisma schema validation passed.
- Migration static/convention checks: **26 passed**, including the new strict Scribe CI target
  allowlist. No SQL was executed by these checks.
- New Scribe/Mind CI configuration regressions: **13 passed** after the final dependency-build
  adjustment. Existing Mind jobs remain unchanged. Scoped lint, formatting and diff checks passed.
- Targeted gateway authorization/renewal/pause tests: **74 passed** with synthetic fixtures;
  these are not real LiveKit or physical-device evidence.
- New dedicated `scribe-postgres` CI job is configured to build contracts, orbit-core and
  observability, create its own loopback-only PostgreSQL fixture, apply the migration chain as
  its test owner, configure the normal runtime-grant path, then run only the Scribe persistence
  suite as `scribe_test_runtime`. Always-cleanup targets only its named fixture container and
  anonymous volume. This workflow has not been pushed or executed.
- Before any database fixture write, the Scribe suite requires the exact dedicated URL, actual
  database/user/listener proof, non-owner restrictions, completed migrations, validated checks,
  enabled triggers, partial unique indexes and workspace/audit permissions. **19 pure tests**
  verify this refusal logic without connecting to a database.

Next required input: an explicitly selected staging/test URL and a normally signed-in fictional
doctor account, or a separately approved isolated test-environment setup. Do not point the test
runner or a preview build at production as a shortcut.
