# Mind release candidate — 13 September 2026

**Not deployed.** This checklist covers the accumulated transcript, counselling,
preparation and usage work, not only the latest cost panel. See the
[implementation ledger](MIND_SPRINT_IMPLEMENTATION_LEDGER.md) for feature limits.

## Verified baseline

- GitHub `main`: `8af631f8c7ae3b368f967660fddd4ebac9f6be64`.
- Local committed HEAD: `561888581257c61f6a22f0e584a9d87efd7a45ad`.
  Their source trees are identical. All candidate changes are uncommitted;
  ancestry divergence alone is not an unreleased feature diff.
- Vercel project `cureocity-mind-web`, root `apps/web`, Node `22.x`:
  production deployment `dpl_HnbbBgVsoi5YKcckyWBdLzcimZwT` is READY at the
  verified main SHA. Its aliases include Mind, Scribe and Care. Shared source
  and accounting changes therefore need Scribe regression checks too.
- Gateway target: project `cureocity-mind`, region `asia-south1`, service
  `live-gateway`, public domain `gateway.cureo.city`.
  Public health returned `ok`, Vertex and authentication required. The response
  reported zero active sessions for that process only; this does not establish
  fleet-wide inactivity or actual clinical functionality.
- Following owner reauthentication, the Cloud Run console confirmed the service
  healthy with `live-gateway-speed-6b95dbb` serving 100% of traffic. Its immutable
  image is `asia-south1-docker.pkg.dev/cureocity-mind/cureocity/live-gateway@sha256:121de622132372e648c950b9c613909d90b7f3a10200400f7d8f387ed8e9c71f`.
  The selected revision uses Vertex in project `cureocity-mind`; its live
  authority URL points to the existing Mind `/api/v1/internal/live-authority`
  endpoint, and the service secret is configured (value not disclosed).
  This is authenticated configuration evidence, not a real provider/session test.
- The same read-only refresh confirmed no GitHub-main or Vercel-production drift
  from the IDs above. No deployment, traffic or environment settings were changed.

## Required release boundaries

1. Confirm public GitHub publication, merge and database-migration scope.
   Both Vercel preview and production builds invoke `prisma migrate deploy`
   before the web build. A later failed build does not undo database writes.
2. Verify the separate preview and production database targets and migration
   ledgers through existing authorized access. Never expose database URLs,
   credentials or patient rows in logs. Do not loosen sensitive environment
   variable protection to get local credentials.
3. Publish only the reviewed source candidate. Exclude the unrelated
   `docs/MIND_SCRIBE_DELIVERY_SPRINTS.md`, local environment files, development
   data, dependency folders and generated output. Preserve the original empty
   local migration directories; they are not tracked Git source and must not
   appear in the release artifact.
4. Use an exact clean commit archive for Cloud Build. The gateway Dockerfile
   copies the build context and this repository has no Docker/GCloud ignore
   file. Never upload this dirty working directory as a container context.
5. Complete CI, including all four isolated Mind PostgreSQL suites and the
   gateway container build. Inspect preview migration/build results and the
   authenticated fictional-client journey before merging the exact checked SHA.
6. Deploy compatible web/schema first, then an immutable gateway revision with
   no traffic. Verify its configuration and health before controlled cutover.
   Recheck the current serving revision and traffic immediately before changes.
   A per-instance zero-session health response is not a drainage guarantee.

## New schema and disabled features

The candidate adds only these two migrations beyond the verified main source:

- `20260926001100_mind_session_preparation`
- `20260926001200_session_usage_connections`

Keep `MIND_SESSION_PREPARATION_ENABLED`, `SESSION_USAGE_RECEIPTS_ENABLED`,
`LIVE_USAGE_RECEIPTS_ENABLED` and `MIND_LIVE_CASE_CONTEXT` off until their
separate runtime gates pass. The first two flags were absent from current
Vercel environment metadata, which preserves their false defaults; gateway
environment still requires authenticated verification.

Before preparation is enabled, verify authenticated reload, KMS, exact-visit
settings, explicit save/retry and start blocking against the test backend.
Before receipts are enabled, verify registration, reconnect attribution, late
receipt drain, missing/overlap labels and authorized export/erasure. Refresh
existing live tabs before the gateway can emit new receipt-failure events.
Real microphone/provider checks require explicit test scope; deterministic
tests and public health do not prove audio latency or clinical quality.

## Compatible rollback

- Disable new gateway receipt registration first; preserve already incurred
  receipt drain, readers, export and erasure after rows exist.
- Keep preparation readers and privacy handling after preparation data exists.
- Preserve encrypted transcript-envelope decoding, the care-record session-work
  reader and live token renewal. Rolling directly back to an older image without
  these readers can make newer saved records unreadable or inaccessible.
- Do not drop additive tables, rewrite applied migration history, or run a reset.
  Capture the exact web deployment ID and gateway image digest before rollout.

## Local release-preflight fixes

- Include the new session-usage PostgreSQL suite in CI, with explicit isolated
  database opt-in. A guard test prevents it silently reverting to three suites.
- Correct the preparation concurrency fixture so it does not create two demo
  clients for one owner, which violates the existing one-demo-client index.
- Show authoritative saved language/style for an already selected visit. If
  Start discovers reused settings that differ from the requested settings, stop
  before consent/capture and require an explicit retry using that saved visit.
  A missing legacy language is labelled as saved, not guessed.

## Final local verification

| Check | Result |
| --- | --- |
| Full web suite | 256 files; 2,247 passed, 37 opt-in database cases skipped |
| Full contracts suite | 38 files; 455 passed |
| Full AI package suite | 22 files; 226 passed |
| Full clinical suite | 24 files; 301 passed |
| Full gateway suite | 25 files; 318 passed |
| Four isolated PostgreSQL suites | 63 passed, zero skipped; includes the opt-in database cases above |
| CI persistence-suite guard | 6 passed; also included in the full web suite |
| Workspace package lint and typechecks | Passed via direct recursive package scripts |
| Full source formatting; whitespace checks | Passed |
| Contracts, AI, clinical and gateway TypeScript builds | Passed |

The isolated PostgreSQL 16.14 cluster applied the 146 source migrations using
the existing guarded fresh-CI reconciliation. Both new SQL files also replayed
against populated tables without changing their row counts. The owned cluster
was stopped afterward; fictional fixtures were retained. This does not validate
production database permissions or application KMS. Counts across different
runs overlap and must not be summed as independent new tests.

The standard Nx wrapper could not initialize a cache lock at the separate saved
checkout path under this sandbox. Running each workspace package's existing
lint/typecheck script directly passed; no cache reset or other checkout change
was made. CI itself has not run for this unpublished candidate. Hosted web build,
gateway container build and authenticated runtime/audio verification remain
separate pending checks, not inferred from TypeScript builds or unit tests.

## Handoff status

No candidate commit, push, PR, merge, preview/production migration, deployment,
cloud configuration change, paid provider call or microphone use occurred.
Owner reauthentication to the existing business Google Cloud account is now
verified. The owner explicitly approved public GitHub publication, main merge,
the two migrations and coordinated web/gateway deployment, with new features
remaining off until runtime validation. The release branch is
`codex/mind-product-release-20260913`, based on verified main. Publication still
requires the database-target and migration checks above; approval is not a claim
that a deployment has completed. Refresh gateway settings immediately before rollout.
