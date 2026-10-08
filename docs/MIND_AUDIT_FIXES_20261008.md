# Mind audit fixes — 8 October 2026

Local implementation on `codex/mind-audit-fixes`, based on `2b9c017512f3ff40c0710617c970cfb850dffb7a`.
This is the fix record for the 13 verified findings in the 8 October audit, not a claim that the entire product is bug-free or production-validated.
Implementation was initially local-only. Release preflight evidence is recorded below;
source publication, merge and deployment must be verified separately.

## Changes and regression coverage

| Finding                                                  | Local change                                                                                                                                                                                                                                        | Main regression evidence                                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01: ambiguous encryption keys                          | Serialize tenant key provisioning; preserve historical keys; read unique-DEK and legacy envelopes; reject ambiguous legacy writes; stage unique-DEK writes behind a default-off flag.                                                               | `tenant-crypto.spec.ts`; real AES-GCM with mocked database/KMS boundaries. See the security release runbook.                                                                    |
| M-02: incomplete live note treated as complete           | Gateway and save/recovery paths preserve capture-incomplete markers. Mind shows captured words and requires clinician confirmation of the exact note/source before signing. Edits invalidate prior approval.                                        | `live-session-completion.spec.ts`, `live-note-risk.spec.ts`, `scribe-capture-review-route.spec.ts`, `mind-capture-review-ui.spec.ts`, `medical-signing-route-behavior.spec.ts`. |
| M-03: resumed audio silently lost                        | Reconcile the server cursor before starting a microphone; compare duplicate upload bytes and metadata; reject conflicts without acknowledging/deleting them; preserve conflicting browser chunks and offer unsaved-audio download.                  | `audio-save-boundary.spec.ts`, `recording-cursor.spec.ts`, `capture-reliability.spec.ts`, `download-pending-audio.spec.ts`, recorder handler tests.                             |
| M-04: private links in telemetry                         | Emit private route templates; remove raw error prose, request secrets, arbitrary extras and breadcrumb payloads from the sink and Sentry events/transactions.                                                                                       | `telemetry-redaction.spec.ts`, `observability-sink.spec.ts`.                                                                                                                    |
| M-05: revoked credentials accepted                       | Require Firebase revocation checks for practitioner cookies/tokens, session exchange and claim redemption; bounded transient retry fails closed.                                                                                                    | `auth-identity-consistency.spec.ts`, `auth-page.spec.ts`, `auth-session-origin-behavior.spec.ts`.                                                                               |
| M-06: plaintext unfinished transcript in browser storage | Encrypt recovery with an authenticated, account-owned key and account/session-bound AES-GCM. Migrate legacy text only after successful encrypted persistence. Require explicit restoration after seven days and preserve unreadable/unsaved copies. | `live-recovery-draft.spec.ts`, `mind-session-recovery.behavior.spec.ts`, recovery-key route and lifecycle tests.                                                                |
| M-07: lost final-save response traps retries             | Reuse a stable operation ID and canonical digest. Atomic lifecycle audit acts as an exact receipt; retry returns saved state without overwriting edits or signatures.                                                                               | `live-note-risk.spec.ts`, `therapist-live-lifecycle-wiring.spec.ts`. A reload of an already-completed live session redirects to its saved workspace.                            |
| M-08: reschedule breaks follow-up link                   | Move closeout follow-up references to the replacement session under the client lock.                                                                                                                                                                | `mind-reschedule-continuity.spec.ts`.                                                                                                                                           |
| M-09: reschedule drops manual settings                   | Copy documentation mode, session purpose and note template from the locked current session.                                                                                                                                                         | `mind-reschedule-continuity.spec.ts`.                                                                                                                                           |
| M-10: stale formulation overwrites newer work            | Require the displayed formulation revision and recheck under the shared client lock. Stale editors receive a conflict.                                                                                                                              | `formulation-write-safety.spec.ts`.                                                                                                                                             |
| M-11: suggestion accepted without being applied          | Return a visible capacity conflict instead of recording success for a full goals/plan collection.                                                                                                                                                   | `formulation-write-safety.spec.ts`.                                                                                                                                             |
| M-12: template changes without changing note             | Reformat the current saved note into an optional template view; retain canonical clinician-corrected clinical/risk fields. Reject stale, signed, pending-edit and manual-AI states. Support intake, treatment and review sessions.                  | `mind-note-template-route.spec.ts`, `reformat-note-template.spec.ts`, `notes-tab-action-gates.spec.ts`.                                                                         |
| M-13: supervision review applies to wrong version        | Record the exact locked signature hash and signing timestamp. Reject reopened/re-signed notes; display older and unbound reviews as historical.                                                                                                     | `note-review-version.spec.ts`.                                                                                                                                                  |

The testing-strategy skill guided coverage of interrupted writes, retries, ownership, stale versions and clinical signing boundaries. Tests exercising UI handlers are deterministic hook harnesses, not authenticated browser or real-device tests.

## Database and release boundaries

Three migrations accompany the changes:

- `20261008000100_tenant_key_identity`: retain all wrapped keys, retire duplicate active rows, and enforce one active row per tenant.
- `20261008000200_note_review_signature_binding`: nullable review signature/timestamp columns with a pair/format constraint. Historical reviews are not backfilled with invented signatures.
- `20261008000300_browser_recovery_key`: encrypted account recovery-key column.

Before deployment, rehearse migrations on a disposable PostgreSQL database, including duplicate-key fixtures, replay and concurrent independent writers. Docker was unavailable during the initial implementation run; it became available during the release retry. Passing mocked transaction tests and static migration checks alone does not prove database concurrency.

## Release preflight — 8 October 2026

- Refreshed GitHub `main`: `2b9c017512f3ff40c0710617c970cfb850dffb7a`, matching the fix branch base and the current ready production web deployment.
- Verified the actual Vercel project and its Git integration. Every web build runs database migrations before the application build, including previews. A branch push is therefore not source-only publication.
- Verified separate Neon `main` and `preview` database branches. The latest preview build's Prisma endpoint matches the preview branch's compute, not the production compute. The production integration is scoped to Production; preview database variables have separate environment entries.
- A read-only, aggregate-only query on the connected production database found 11 tenant-key rows, zero tenants with multiple active keys, zero tenants with ambiguous same-wrapping-key identities, and zero unfinished migrations. No key bytes, patient records or credentials were read. This is a point-in-time check, not a future concurrency guarantee.
- Full environment-variable metadata confirms `TENANT_CRYPTO_UNIQUE_KEY_WRITES` is absent. No environment value or security setting was changed; the new envelope writer remains disabled.
- The web release does not deploy the independent live gateway or continuity service. The gateway incomplete-capture fix remains a separate rollout; continuity's existing production KMS limitation still applies.

Read [MIND_SECURITY_FIX_VALIDATION.md](MIND_SECURITY_FIX_VALIDATION.md) before any release. `TENANT_CRYPTO_UNIQUE_KEY_WRITES` remains absent/false until all independent readers and writers are upgraded and old processes are drained. After any unique-format write, rolling back to an old reader is unsafe even if the flag is turned off. No historical keys or ciphertext should be deleted to unblock a rollout.

## Remaining runtime and clinical validation

1. Exercise fictional accounts through real Firebase sign-in, disabled/revoked credentials and recovery-key retrieval; measure latency and verify no-store responses.
2. Exercise microphone capture, refresh/resume, two tabs/devices, denied permission, offline/storage-quota failures, save-response loss and unsaved-audio downloads on supported browsers.
3. Verify live gateway and web together using fictional session content, including final model/tail failure and exact capture review before signing.
4. Have a clinician review real-provider template output and incomplete-capture reconstruction. Generated views still need human review; code checks are not clinical validation.
5. Verify deployed telemetry with fictional bearer links and review historical telemetry retention separately. This change does not erase previously collected logs.

Existing pending browser audio is still held in IndexedDB for recovery; this audit's M-06 fix concerns transcript recovery text and does not claim device-wide encryption or protection against active same-origin malicious scripts. Recovery expiry does not automatically delete the only unsaved copy. Simultaneous recording is conflict-detected, not automatically merged into a clinically reliable conversation.

## Validation results

Final local results:

- Web: **4,082 passed, 74 database-dependent tests skipped**, 374 test files passed. Full run used two workers; no assertion failures remain in that run.
- Live gateway: **334 passed**, 26 files, including local loopback WebSocket fixtures.
- Shared contracts: **516 passed**, 40 files.
- Shared crypto: **34 passed**, four files.
- Continuity service: **58 passed**, seven files, including the removed journal plaintext-on-error fallback.
- Total across those suites: **5,024 passing tests**, with the 74 skipped tests explicitly excluded.
- Web, gateway and continuity TypeScript checks passed. Gateway/shared-contract builds passed. Prisma schema validation, 26 migration-checker tests and static replay-safe migration checks passed.
- Changed-file ESLint, whitespace and source-formatting checks passed. Final sequential web and continuity typechecks also passed after all source edits stopped.

Release retry database results: all six PostgreSQL-backed web suites passed,
**120 tests** on PostgreSQL 16.14 (Mind 63, Scribe 40, reception 17). This includes
46 guard tests already counted above and closes all 74 previously skipped
database tests; the combined non-duplicated suite total is **5,098 passing tests**.
The actual pre-fix encryption migration, replay, constraints, preserved ciphertext
and six-process provisioning rehearsal also passed on PostgreSQL 16.14 and 17.11,
matching production's PostgreSQL major version. This is
database evidence, not a real microphone, Firebase/provider or clinical workflow
test.

Earlier combined runs exposed stale test fixtures, missing capability-inventory entries and runtime-dependent test behavior; these were corrected. One run also suffered resource-related timeouts while several full typechecks competed. The final bounded run passed. Node 24's native Web Locks are explicitly covered; the no-Web-Locks fixture no longer accidentally deadlocks on that runtime. This is still not a real browser/device test.

## Historical data and additional limits

- Previously broken follow-up pointers are not automatically backfilled by this code change. Inspect any affected historical records before a separately authorized repair.
- Older plaintext browser recovery copies migrate when their authorized session is opened successfully. Conflicting or failed migrations preserve the only copy; no claim is made that every existing device has been cleaned.
- The continuity encryption reader/writer was upgraded as another consumer of the shared key table. Its pre-existing KMS factory currently wires the local-development provider, not GCP. Do not deploy that service against GCP-wrapped production records without separately wiring and verifying the correct provider.
- The journal caller now fails with a generic 503 before writing if encryption fails. Existing plaintext journal columns/retention remain a separate schema and migration concern; this patch does not claim removal of every plaintext clinical field across the platform.
- No authenticated production session, real clinician/patient workflow or clinical-output evaluation was performed. A safe release needs the gates above, not just green unit tests.
