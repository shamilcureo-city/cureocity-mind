# Scribe flow fixes — local verification, 8 October 2026

## Status and boundaries

Implemented in the attached `codex/scribe-microphone-diagnostics` worktree, based on `2b9c017512f3ff40c0710617c970cfb850dffb7a`. Existing uncommitted microphone and transcription-safety work was preserved. This document covers the combined local release candidate, not a production release.

At the local verification checkpoint, no commit, push, merge, deployment, database migration, account approval, historical-record rewrite, payment or real microphone/provider test had been performed. Mind was not redesigned. Its capture cadence and product workflow remain regression-tested, with one intentional shared-auth safety change: a different Firebase identity matching an existing contact phone is rejected rather than replacing the original identity. Existing same-identity logins remain supported; Scribe adds the explicit provider-linking UI.

## Changes by workflow

| Stage                      | Local correction                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                    | Phone linking preserves the canonical Firebase identity; it no longer silently rebinds an existing clinician account to another UID. Existing split identities still need verified account recovery.                                                                                                                                                |
| Registration               | Pending Scribe clinicians can submit their profile and credential details. Submission does not approve clinical access or mark credentials verified.                                                                                                                                                                                                |
| Clinic queue               | Rescheduled visits are excluded from the waiting queue. Scribe uses the configured clinic timezone, with Dubai as the doctor default; saved timezone choices and Mind defaults remain respected.                                                                                                                                                    |
| Consent and mode selection | Dictation, upload and live capture require explicit mode-specific confirmation. Dictation does not erase an ambient-recording refusal. Consent is reread under the client lock; changing encounter or mode resets unchecked confirmations. Active capture cannot silently change modes through a URL.                                               |
| Microphone/start           | Prior microphone diagnostics remain. Minting a Scribe live token prepares capture without starting the consultation. The trusted gateway activates it once, on first PCM input, after current ownership, capability, lifecycle and consent checks. Stop/Pause and delayed startup are ordered so discarded audio cannot activate a stopped capture. |
| Live transcript            | Partial speaker segmentation cannot drop words from the provider's fuller transcript: all words remain with an unknown-speaker/review warning. Known prompt-example contamination is quarantined. This is not a general hallucination detector.                                                                                                     |
| Recovery                   | Finalized utterances receive encrypted, append-only server checkpoints in the existing recovery field. No browser PHI storage was added. Save failures stop capture; active/paused/finalizing/unsaved navigation is guarded. Reload restores acknowledged source.                                                                                   |
| Stop and authorization     | Manual End stops input first, reserves sufficient acknowledged authorization, then requests finalization. Scribe renews earlier to leave finalization headroom. Mind's renewal cadence is unchanged; expiry and consent are never bypassed.                                                                                                         |
| Final saving               | A stale or truncated final cannot replace a fuller acknowledged checkpoint. The finalizer reads it under the same Client → Session locks, rejects conflicting source, and preserves incomplete-capture warnings. Failed persistence cannot unlock review/signing.                                                                                   |
| Reopen and sign            | The doctor sees the current signed canonical note, not the original AI draft. A competing signature response reloads the saved winner rather than claiming the local draft was signed.                                                                                                                                                              |
| Vitals                     | Unsigned AI vitals no longer enter trends. Trends use corrected, currently locked signed notes and explicit manual readings; historical unreviewed AI rows are excluded without deletion. Adding one manual measurement preserves untouched measurements.                                                                                           |
| Prescriptions              | Route and timing survive PDF, prescription sharing and after-visit outputs. Unlocked prescriptions are editable and cannot be exported as currently signed.                                                                                                                                                                                         |
| Plans                      | Scribe settings show AED 500/200 consultations and AED 750/500 consultations as request-only offers. Actual current entitlement, existing payment history and plan management remain visible. Mind's INR plans are unchanged.                                                                                                                       |

## Automated evidence

Pinned Node 22.23.2 was used. Tests use fictional fixtures, mocked database/provider boundaries and, for streaming transport tests, a temporary local fake WebSocket service.

| Suite                       | Passed | Skipped |
| --------------------------- | -----: | ------: |
| Web — 381 files             |  4,162 |      74 |
| Shared contracts — 40 files |    545 |       0 |
| LLM package — 22 files      |    242 |       0 |
| Live gateway — 27 files     |    362 |       0 |
| Total                       |  5,311 |      74 |

The skipped cases remain environment-dependent validation gaps, including database-backed checks. Passing mocked race tests does not prove PostgreSQL isolation or live provider behavior.

TypeScript checks passed for web, contracts, LLM and gateway. Scoped ESLint, formatting checks and `git diff --check` passed. Independent review added regression cases for stale-tab transcript replacement, consent races, recording-mode state reuse, late first-audio activation and delayed startup after Stop.

## Release sequence — requires separate approval

1. Review and commit the intended local changes; do not include unrelated work or secrets.
2. Deploy the compatible gateway first. Its new `preflight` and `capture-activation` purposes fall back to the old full capture verifier only for unsupported-purpose HTTP 400, never for a denial, outage or expired authority.
3. Deploy the web changes. A new web with an old gateway fails closed for a scheduled live session; do not reverse this rollout order.
4. Verify exact web commit and gateway revision, then run an authenticated fictional-data smoke test. The shared schema needs no migration for this change, but the deployment pipeline must still be inspected for its normal migration behavior.
5. With explicit microphone permission, test built-in mic readiness, silence, actual speech, Pause/Resume, manual End near renewal, tab reload recovery, network interruption, note correction/sign/reopen, PDF output and a two-participant teleconsult. Confirm credits are not consumed merely by opening readiness or minting a token.
6. Run the database-backed checks against an isolated test database and a clinician-supervised acceptance pass before broader clinical use.

## Remaining decisions and operational limits

- AED checkout is not activated. VAT treatment and whether the new plans should become self-service remain owner decisions; requests do not charge money or grant credits.
- Historical login conflicts, consumed credits and clinical records were not repaired automatically. Already-signed inaccurate records require clinician review and the normal audited correction workflow.
- A browser crash can lose words that have not yet received a server checkpoint acknowledgement. Multi-tab source conflicts are surfaced, not automatically overwritten or merged.
- Browser suspension, network/provider failure or consent withdrawal can still prevent a final AI note. Capture stops and incomplete-source recovery is retained; authorization is not extended beyond its valid lease.
- First-audio activation is not an end-to-end billing receipt: if its database transaction commits but its acknowledgement is lost before the gateway processes audio, credit outcome is uncertain. No automatic refund policy or financial mutation was introduced.
- Real Firebase/OTP linking, cloud database concurrency, microphone hardware, live ASR accuracy, deployment routing and clinical accuracy were not validated by this local test pass.
