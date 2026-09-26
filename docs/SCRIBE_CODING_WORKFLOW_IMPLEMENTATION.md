# Scribe coding worksheet: local third milestone

## Problem and scope

The doctor differential already returns optional AI-generated ICD-10 strings, but the medical note
has only a free-text assessment. There is no general-doctor code catalogue or persisted review
workflow. Mind's curated ICD-11 mental-health catalogue is not a substitute for one.

As a doctor, I can review existing suggestions or enter a code, identify its classification and
release, document why it applies, and save my coding worksheet separately from the clinical note.
The worksheet must never claim that an AI suggestion has been catalogue-validated or submitted
as an insurance claim. This milestone does not change Mind.

## Acceptance criteria

- Only the owning active doctor with medical-documentation capability can read/write the worksheet
  for an active patient and completed encounter. Signed encounters are read-only.
- Suggestions remain pending until a doctor makes an explicit decision. The doctor may include,
  exclude, or leave an item pending; reviewed worksheets cannot contain pending decisions.
- Included entries require a code, label, explicit WHO ICD-10 or US ICD-10-CM classification,
  release and supporting documentation. Format checks are not catalogue validation. Unsupported
  systems, including ICD-11 and procedure/claim coding, remain out of scope for this milestone.
- Saving a draft is distinct from recording a review. Only acknowledged server persistence can
  show a saved/reviewed state. Review metadata is server-owned.
- Encrypted patient-linked storage reuses Scribe lifecycle locks, revision checks and DSR handling.
  Saves reject a changed baseline draft and signed/deleted/inactive records. A later different note
  makes an earlier coding review stale; neither refresh nor a delayed response may erase local work.
- Coding review does not clear capture or prescription safety gates and is not part of the clinical
  signature. No clinical note, diagnosis list, prescription, claim or external system is changed.
- The implementation and any additive migration stay local. No migration or deployment is run.

## Design

Reuse Scribe's white `#ffffff`, source grey `#f6f6fa`, ink `#0b0c10`, secondary `#525965`, separator
`#e3e5ee` and warning `#985516`. Fraunces headings and Inter body retain the existing product roles.
One left-aligned worksheet has a selectable code list and one detailed entry editor; phones stack
the panes. The deliberate include/exclude decision is the focus, not a coverage score or dashboard.
Controls have 44px targets, visible keyboard focus, and no unnecessary motion. Copy distinguishes
local edits, saved drafts and recorded clinician review.

## Test plan and release gates

Use unit tests for classification/entry constraints, duplicate codes, review state and identity.
Use route tests for authorization, lifecycle locks, concurrency, encryption/decode errors,
server-owned metadata and signed immutability. Component/hook tests cover unsaved work,
late/session-switched responses, failed saves and stale reviews. Inspect desktop/mobile layouts
using fictional fixtures only. Run the web regression suite and typecheck.

Before release, apply the reviewed migrations to an approved test environment, test authenticated
records with real storage, and obtain qualified clinician/coding review. A pilot should measure
time to review and whether clinicians notice deliberately incorrect or unsupported suggestions;
these are proposed measurements, not established product performance.

## Verification completed locally

- Node 24.19.0 full web suite: 318 test files passed; 3,057 tests passed and 44 opt-in database
  tests skipped. The new coding suites cover domain validation, API authorization/concurrency,
  client request lifecycle, UI review states and additive migration source checks.
- Full web TypeScript, scoped ESLint, formatting and diff whitespace checks passed.
- The actual panel and request hook were exercised with a memory-only fictional transport at
  `http://127.0.0.1:3000/dev/scribe-coding`. Desktop and 390px mobile layouts were inspected.
  Verified pending suggestion import, failed-save preservation, acknowledged draft/review saves,
  invalidation after note changes, explicit discard protection and signed/read-only controls.
- Review caught and fixed capacity controls that prevented removing the thirtieth entry and a
  save response that dropped remaining cached suggestions. Note-signing safety regression tests
  continue to pass; clinical note content and signature payloads are unchanged.
- Authenticated database storage, real-user concurrency, code correctness and clinical usefulness
  are not established by these tests. The new `20260930000000_scribe_coding` migration (which
  follows the existing workspace and teleconsult migrations) was authored but not applied.
  No production build or deployment was performed.

## Classification references and non-goals

WHO's [ICD-10 2019 browser](https://icd.who.int/browse10/2019/en) and CDC's
[ICD-10-CM overview](https://www.cdc.gov/nchs/icd/icd-10-cm/) identify distinct classifications.
CDC's [release files](https://www.cdc.gov/nchs/icd/icd-10-cm/files.html) are date-specific.
Static reference links send no patient query from Scribe. These references do not validate a
doctor's entered code or establish which classification a particular payer requires.

Automated coding, authoritative catalogue search/validation, automatic diagnostic inference,
ICD-11, CPT/procedure codes, payer-specific rules, claims, reimbursement advice and signed-code
attestations require separate work. This milestone records clinician choices, not billing readiness.
