# Mind follow-up fixes — release notes

Base: `5f48950` (main after PR #173); fixes follow PR #172.
Working branch: `codex/mind-followup-fixes`.

## Changes

1. Live token-renewal failures flag unconfirmed capture before invalidating the connection. Acknowledged pause is exempt. Recovery and reconnect retain the integrity warning.
2. Therapy guides use kind-aware canonical summaries: intake history is not treated as an empty SOAP note, and signed notes take precedence over older drafts.
3. Therapy-guide cache identity includes presenting concerns.
4. Preparation freshness covers the actual grounding inputs, canonical note, plan identity, and homework. Old briefs with no fingerprint are explicitly stale. GET reads saved data; generation is an explicit capability-guarded POST.
5. Pending batch/file audio and recording cursors use account/session-bound authenticated encryption in IndexedDB. The key is obtained through the existing ownership-checked recovery route and is never persisted in the browser. Logout/auth-lock cancels subsequent uploads and seals the known capture tail before closing the key context. Explicit discard warns about permanent loss and blocks automatic completion from that device.

## Storage and rollout boundaries

- No new Prisma/database migration or server encryption flag change is required. `TENANT_CRYPTO_UNIQUE_KEY_WRITES` must remain disabled for this release.
- Browser IndexedDB upgrades from version 1 to version 2. Only the currently authorized session's legacy chunks/cursor migrate. Atomic compare-and-swap preserves old copies if encryption, commit, or collision checks fail. Other sessions and other devices are not silently purged.
- An older recording tab can block the upgrade. Close that old recording tab only after preserving its unsaved work, then reopen the session. The new code fails closed rather than writing plaintext.
- Browser database versions do not downgrade automatically. A rollback to code that opens version 1 will reject version-2 databases; rollback requires a compatible browser-storage reader. Do not instruct users to clear storage to bypass this: it can delete the only recovery copy.
- Unsaved recovery has no automatic destructive expiry. The clinician can retry, privately download, or explicitly discard. Downloads are ordinary unencrypted WAV files. Discard removes local pending parts, not uploaded server audio; it is not a global clinical-record deletion.
- Cross-tab sign-out notification is best-effort when browser storage is unavailable. Server authorization still guards every upload and key request. Encryption at rest does not protect against active same-origin script compromise.
- Browser storage exhaustion can still prevent durable saving; memory-only bytes require keeping the current tab open. The implementation does not claim to recover audio never captured or committed.

## Validation and release status

- Full local web suite: 382 files passed, 4,156 tests passed, 74 database-dependent tests skipped.
- TypeScript (`tsc --noEmit --incremental false`), targeted lint, and whitespace checks passed.
- Database-backed tests require the isolated PostgreSQL test environment; production was not used for these checks.

`node scripts/test-audio-recovery-browser.mjs` passed on Chrome/151.0.7922.77. It exercises real Chromium IndexedDB/WebCrypto with fictional bytes and keys on localhost: migration, reload recovery, account/session isolation, wrong-key rejection, blocked upgrade preservation, and closed-context refusal. This is not authenticated application, microphone/provider, or clinical validation.

Commit, push, PR, merge, web deployment, production checks, and the separate live-gateway rollout remain distinct actions. These local test results do not establish production or clinical validation.
