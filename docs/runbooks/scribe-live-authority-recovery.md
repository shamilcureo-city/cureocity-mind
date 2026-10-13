# Scribe live authority interruption recovery

## Incident and scope

The 2026-10-12 interruption investigation found a gateway connection lasting
about 72 seconds, not a normal five-minute token expiry. Web verifier requests
returned HTTP 200; one nearby response took approximately two seconds, matching
the old gateway timeout. A verifier timeout is the leading explanation, not a
conclusively correlated exception: the previous gateway discarded its close
reason. Do not diagnose this as a physical microphone or billing failure from
the screen message alone.

This patch is local remediation, not evidence that the production incident has
been resolved. It changes shared enforcement plumbing used by Mind and Scribe,
with Scribe-specific recovery copy. No consent, account, billing, database,
provider, hosting region or feature flag is changed.

## Safety contract

- Every authorization failure stops the connection. No grace period, automatic
  microphone restart or cached permission grant is introduced.
- Current consent, ownership, vertical, lifecycle, mandatory capabilities and
  token expiry remain required. Capture cannot use a queued-finalization grant.
- Temporary verifier failures are distinct from an explicit access denial. Both
  fail closed. Operational diagnostics contain categories/timing, not tokens,
  identities, patient content or raw dependency errors.
- Scribe retains confirmed transcript on the current page and flags interrupted
  capture for review. Unsent PCM is discarded at authorization loss, not replayed
  under a later grant. Retained page state is not a claim of durable saving.
- Explicit Resume runs microphone readiness, mints a new token, and waits for a
  newly authorized gateway connection before clinical capture restarts.
- The reason is an additive field on the existing `unauthorized` status. Older
  clients still stop; newer clients treat absent/unknown reasons conservatively.

## Regression plan

| Area               | Test type and required coverage                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wire compatibility | Contract tests: old and new status payloads, unknown reason still stops capture.                                                                                                                                               |
| Verifier           | Mocked route tests: both practitioner verticals, withdrawn/missing consent, ownership/lifecycle/expiry/manual-mode denial, inactive account, database/capability/teleconsult dependency failure. No failure returns authority. |
| Gateway            | Unit/integration tests: timeout/HTTP errors, late success after expiry or denial, token renewal races, fresh ordered output batches, no cross-purpose grant reuse, per-event optional capabilities and therapy context epochs. |
| Browser recovery   | Component lifecycle tests: mic off, no automatic retry, stale socket ignored, transcript retained, incomplete-capture warning, fresh token on explicit Resume, denied retry remains off, no unsent PCM replay.                 |
| Shared regression  | Full gateway and contract suites; web live-token, consent, teleconsult, Scribe lifecycle and Mind lifecycle tests; typechecks and lint.                                                                                        |

All listed safety transitions need passing tests, not merely a line-coverage
percentage. Existing isolated timeout tests did not expose the serialized
output-check amplification or distinguish service failure from genuine denial.

## Local verification — 2026-10-12

- Web: 4,185 tests passed across 382 files; 74 environment-gated tests skipped.
- Gateway: 376 tests passed across 28 files, including local socket tests.
- Contracts: 520 tests passed across 41 files.
- Workspace package builds, web/gateway/contracts typechecks, changed-code lint
  and diff whitespace checks passed.
- Independent review found and resolved a shorter-interval configuration
  regression and an old finalization timer that could interrupt resumed capture.
  No outstanding actionable finding remained in that review.
- Database-backed gates, a real microphone, production latency and a long live
  consultation were not exercised. No production state was changed.

## Release and remaining validation

Web and gateway are separate deployments. Release requires explicit permission;
do not assume a web merge deploys the gateway. Confirm a quiet recording window,
stage the exact gateway image at zero traffic, check health/authentication, then
switch traffic with a rollback revision retained. No migration is added here.

Before calling the live issue resolved, exercise an explicitly consented
synthetic consultation beyond token renewal, including speech/silence, Pause,
Resume, End, a forced verifier outage and recovery. Confirm the real device's
microphone stops on failure, existing words remain, no audio resumes unattended,
and missing words remain flagged before signing. Observe verifier request count,
latency and sanitized close reasons on the deployed revision. Local automated
tests do not establish real-device audio or production reliability.
