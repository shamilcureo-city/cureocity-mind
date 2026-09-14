# Clinician-confirmed work continuity — local implementation slice

This implements a bounded part of MP07, not the complete therapy-delivery system. No release or production migration is performed by this change.

14 September continuation: [recorded-work history](MIND_WORK_HISTORY_2026_09_14.md)
is now implemented locally as a read-only projection over these existing versions. It groups
work changes by source visit and keeps earlier wording separate, without adding
an intervention-event store or changing the current work pointer. The original
storage scope below remains relevant; the continuation records its own checks.

## What is reused

The existing encrypted, versioned care-record API stores an optional `sessionWork` section. Recorded and manual-session closeout reuse the same collapsed care-record UI. The psychologist explicitly chooses used/adapted/paused/not-used and writes what happened. Client response may remain blank. Existing agreements/homework remain the one place for agreed next steps.

This is not inferred from selecting or reading a guide, clicking a cue, completing a questionnaire or signing a note. Confirmation does not change a clinical note, create an assignment, contact the client, change consent, discharge, or send context to AI.

The server checks the active-client lifecycle lock and same-owner/client source session under a session lock. New or corrected work requires an in-progress/completed visit and the actual server-provided scheduled-date snapshot. Dates are shown in IST; scheduled date is not labelled as actual attendance or intervention time.

## Partial continuity, not a longitudinal delivery ledger

The current care record holds one work entry; previous entries remain in immutable care-record versions. Recording or correcting an older visit can replace that current pointer. Preparation explicitly identifies its source visit and care-record save version/date, and does not claim it is the latest visit or evidence of today's progress. Open the source visit to correct its entry, and use care-record version history for earlier wording.

Exact guide-content identity/version, an intervention event timeline, note insertion, multi-visit aggregation and sending approved context to live AI remain separate future work. No clinically reviewed pathway or efficacy claim is introduced here.

## Data and release boundaries

- Earlier encrypted V1 bodies decode unchanged; absent work means absent, not delivered.
- Older callers may omit the new section when editing another field. The new server preserves existing work and supports replay of those exact operation receipts.
- The complete section remains inside `bodyEncrypted`, covered by the existing owner/capability checks, care-record audit, DSR full-body export and client-erasure deletion. No new table or migration is needed.
- After a new body is stored, an older **binary** with the previous strict decoder cannot read it. Any rollback must retain/backport the additive decoder and omission-preservation logic. Do not deploy an incompatible prior reader or rewrite historical records to make it fit.
- Deploying the web/API/contracts reader set and validating authorized fictional sessions is separate from local tests. No gateway change is required for this non-AI slice.
