# Mind security fixes — local verification and release gates

## M-01: tenant encryption-key identity

The unique-key format uses the AES-GCM v1 container with key identifier
`dek:<PsychologistTenantKey.id>`, identifying a DEK rather than its shared KMS
wrapping key. Its writer is **off by default**; only the exact environment value
`TENANT_CRYPTO_UNIQUE_KEY_WRITES=true` enables it. Reads accept both formats
regardless of that flag and constrain every candidate to the owning tenant.
Legacy KMS-id envelopes try preserved historical DEKs using authenticated
decryption. No key rows or patient ciphertext are deleted or rewritten.

While the flag is absent/false, writes retain the old KMS-id envelope only if a
fresh database check finds exactly one tenant-owned key row with that wrapping
ID and it is the selected active key. Retired rows count too. Ambiguous tenants
fail closed instead of generating another value that old readers can misread;
their historical data remains readable by the upgraded reader. Expect writes
for affected tenants to remain blocked during the staged rollout. Do not delete
their old keys to unblock writes. The compatibility check is intentionally not
cached, even when the active plaintext key is cached.

Provisioning uses a per-tenant transaction advisory lock, with audit in the
same transaction. The key-identity migration retires duplicate active rows,
preserves all wrapped keys and adds a partial unique index for one active DEK.
The 20-second transaction ceiling bounds provisioning/KMS delay.

The continuity-service encryption consumer now uses the same envelope formats,
writer flag and `tenant-dek:<psychologistId>` advisory-lock namespace as the web.
It resolves the active key inside the write transaction, and rotation retires the
prior key, provisions the replacement and records its audit atomically. When the
flag is off, a rotation reusing the KMS wrapping ID rolls back rather than making
legacy writes ambiguous. Unwrapped keys are cached by tenant plus unique row ID;
all historical rows remain available for authenticated legacy decryption.

The continuity journal caller now returns a generic HTTP 503 without creating a
journal entry or its creation audit when encryption fails (including an ambiguous
key identity). It no longer silently falls back to an unencrypted-only write or
logs raw provider errors. Successful writes still retain the existing plaintext
`JournalEntry.content` alongside `contentEncrypted`; removing that plaintext,
migrating historical journals and redesigning read paths are separate work, not
part of this key-identity repair. Do not describe this as encryption-only journal
storage or as cleanup of previously saved plaintext.

Continuity's existing `encryption.module.ts` factory still only constructs the
development KMS provider. These changes make its encryption service compatible
with both envelope formats **when the injected KMS provider can unwrap the stored
keys**; they do not wire production GCP credentials or establish its production
deployment status. Do not enable this consumer against a GCP-backed database until
its provider factory supports the actual wrapping keys and the cross-service
checks below pass. Never substitute a development key for an unavailable GCP key.

Unit regressions use real AES-GCM and mocked database transactions. Release
rehearsal additionally uses `scripts/rehearse-mind-audit-migrations.mjs` and
`scripts/rehearse-mind-crypto-worker.ts` against an explicitly guarded disposable
localhost database, never production. On 8 October 2026, PostgreSQL 16.14 and 17.11 passed
the actual pre-fix-schema migration and raw-SQL replay, preservation of all four
wrapped-key fixtures (including a creation-time tie), the one-active-key index,
review signature constraints, and historical/new ciphertext reads after process
restarts. Six independent processes using the actual web encryption module
created exactly one key and one atomic provisioning audit; every ciphertext
decrypted in a fresh process. The ambiguous default-off writer failed closed.
Production runs PostgreSQL 17; the matching-major rehearsal passed before source
publication. See the fix report for subsequent release evidence.

Continuity regressions model two service instances, failed-rotation rollback and
the original legacy reader. The separate continuity consumer's real deployed KMS
and cross-service behavior remain unvalidated by the web PostgreSQL rehearsal.

Deployment must be staged, not an assumed atomic web/gateway cutover:

1. Rehearse and apply the key-identity migration; preserve/back up every historical
   wrapped key. Do not enable the writer flag yet.
2. Deploy both-format readers with the flag absent/false to the web fleet and
   **each independently deployed consumer** of tenant-encrypted columns. Inventory
   live-gateway revisions, workers, continuity-service, exports, backfills, preview
   environments sharing the database, and rollback builds. A service that only
   exchanges plaintext via authenticated APIs needs no encryption change, but
   verify that against its actual deployed revision; source presence alone does
   not prove the deployed consumer set. No live gateway compatibility is asserted
   by these web unit tests.
3. Drain every old revision/job that might read those columns. Verify old legacy
   ciphertext (including duplicate-key fixtures) on all upgraded reader paths.
   Verify provisioning/rotation writers also obey the active-key invariant; the
   advisory lock cannot serialize an unrelated old writer that ignores it.
4. Only then set `TENANT_CRYPTO_UNIQUE_KEY_WRITES=true` on web writer deployments
   and any other writer that implements this flag. Verify new-format ciphertext
   from the web on all consumers and old ciphertext after process restarts.

After the first unique-format write, clearing the flag stops further such writes
but **does not make rollback to an old reader safe**. Keep both-format readers in
every rollback build or use a forward fix. Never rewrite/delete old ciphertext or
keys as an improvised rollback. No flag has been enabled by this local work.

## M-04: error telemetry

Browser error reporters emit route templates, not full locations. The sink
discards raw exception prose/stack and arbitrary extra data; Sentry hooks also
strip request bodies, cookies, headers, user context, breadcrumb arguments,
exception prose and span payloads. Route, digest and source positions remain
available. Verify a fictional token-bearing page error through deployed
telemetry before release and separately assess historical telemetry retention.
Local tests use fake telemetry transports, never a real patient token.

## M-05: Firebase revocation

Practitioner page/API credentials, session exchange and claim redemption
require revocation checking. Revoked/disabled/deleted identities are terminal
failures; transient failures retain bounded retry and fail closed if exhausted.
Test disabled and revoked fictional accounts in a non-production Firebase
project and measure navigation/sign-in latency before release. Local SDK mocks
verify the required flag and denial order, not a live Firebase configuration.

No production migration, token revocation, log cleanup or deployment is part
of these local code changes.
