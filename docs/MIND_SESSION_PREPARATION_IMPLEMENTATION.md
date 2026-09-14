# MP03-2: session-bound preparation

Status: **implemented locally; feature off by default; not migrated or released**.
Updated 13 September 2026. Verification and outstanding release gates are recorded
in [the sprint ledger](MIND_SPRINT_IMPLEMENTATION_LEDGER.md).

## Implemented slice

- Today passes its exact booking to a small, optional focus panel. Session setup
  can explicitly select/create a visit before preparing; ordinary Start remains
  available without preparation. Selecting a visit never starts consent,
  recording, a manual note or AI. The returned ID is retained for later starts.
- Confirmed preparations reopen on that visit. Manual, normal and live session
  pages expose read-only preparation separately from the note and AI context.
- New writes require the displayed client ID as well as session, revision and
  scheduled time. Immutable database revisions and a parent-identity guard keep
  an existing preparation from following a reassigned session to another client.
- Lost preparation-save replies retain the same operation ID. Ambiguous visit
  creation without a confirmed ID requires selecting the visit from Today;
  no automatic duplicate create. HTTP 408/429 are treated as ambiguous too.
- Unsaved edits and pending saves are distinct. Pending writes block Start and
  visit changes; unadopted edits require explicit discard before Start/Back, or
  save/discard before Today reschedule/no-show. Changed appointment dates remain
  visible and require explicit re-adoption even if wording is unchanged.
- No legacy scratch is imported or deleted. With the feature enabled, the old
  scratch editor is hidden; existing localStorage remains untouched. Explicit
  scratch import is not part of this slice.
- `MIND_SESSION_PREPARATION_ENABLED=true` enables UI and new writes only after
  migration verification. Default is false. Authorized GET/export/erasure remain
  compatible independently of that flag; only verified absence of the additive
  table is skipped by privacy operations. Present-table/query/decryption errors
  fail closed.

The remaining sections describe the design constraints implemented by this slice
and its separate runtime acceptance gates. They are not deployment evidence.

The intended outcome is one clinician-confirmed preparation focus for one exact
visit, available again when that visit opens. It must not become a diagnosis,
consent, evidence of delivered treatment, or text silently inserted into a note.
This proposal concerns Mind psychologists; Scribe encounter behavior is unchanged.

## Original behavior and problem

- `apps/web/components/app/PreparePanel.tsx` renders `TodayIntent`, a private
  scratch field. `apps/web/lib/prepare-intent.ts` keys plaintext browser storage
  by client and IST calendar day, not by session or practitioner. Two visits for
  the same client that day share this scratch field. It is not a clinical record.
- `TodaySessionCard.tsx` knows the booking ID, and `RecordConfirmStrip.tsx` can
  receive `expectedSessionId`, but their preparation panels receive only client ID.
- The client `/prepare` API assembles historical context, not a confirmed plan
  for a target visit. Its AI brief is a separate generated cache.
- `POST /api/v1/sessions` supports exact booking selection through
  `expectedSessionId`. Without it, `selectReusableSession` chooses the earliest
  still-open booking on the same IST day. A date or a client ID alone therefore
  cannot identify the intended preparation target.
- `MindManualNoteDraft`, `ClientMindCareRecord`, `SessionAgreement`,
  `phaseSnapshot`, and `consentSnapshot` have different meanings. None should be
  reused as storage for this preparation focus.

## Product behavior

1. Open or select an exact visit, showing its client, date and time.
2. The psychologist writes a focus and explicitly selects **Use for this visit**.
   Editing alone does not save or adopt it. Unconfirmed edits stay in memory.
3. Show **Saved for this visit** only after the server acknowledges the exact
   session, revision and operation. Keep the draft visible if saving fails.
4. Display the confirmed focus when the same visit opens, with the label
   **Preparation — not evidence of what happened in the session**.
5. Before the visit starts, allow an explicit replacement or clear operation,
   preserving earlier revisions. After starting, preparation is read-only;
   session documentation remains the place to record subsequent decisions.

Preparation is optional. It does not start a microphone, bypass consent, select
treatment, or add a new clinical readiness policy. It must not block ordinary
reading of historical sessions that have no preparation record.

### Exact bookings, walk-ins and multiple visits

For existing bookings, pass the exact session ID from Today into the panel. Never
select a preparation record using only the client, date, latest session, or the
first available record.

Walk-ins that choose preparation use a bounded two-step start: use the existing session selection/create
request to resolve the canonical visit first, show that visit for confirmation,
then continue the existing manual-note or consent/capture sequence. Retain the
resolved ID on retry; do not create another visit merely because saving failed.
Changing the client must clear the selected visit and unconfirmed draft. When
several same-day bookings exist, show the selected booking before adoption and
allow return to the booking chooser; do not silently move preparation between them.

The first implementation should not import legacy browser scratch automatically.
If explicit import is included, disclose that it is unverified device text that
may come from a shared browser; require the clinician to review and adopt it for
the displayed visit. Do not infer its author, date of clinical relevance, or
permission from the old storage key. Removing historical device storage is a
separate disclosed cleanup decision, not a hidden migration.

## Smallest durable data model

Add a dedicated `MindSessionPreparation` model, mapped to
`mind_session_preparations`, with immutable revision rows:

| Field            | Purpose                                                  |
| ---------------- | -------------------------------------------------------- |
| `id`             | Server-generated record ID                               |
| `sessionId`      | Required session FK; cascade on physical parent deletion |
| `psychologistId` | Required author/tenant FK                                |
| `revision`       | Positive integer, unique with `sessionId`                |
| `operationId`    | Validated UUID retry identity, unique with `sessionId`   |
| `bodyEncrypted`  | Tenant-encrypted, schema-validated preparation body      |
| `createdAt`      | Server confirmation timestamp                            |

The V1 encrypted body contains only a focus of up to the existing 200-character
limit, the source kind `CLINICIAN_WRITTEN`, and the scheduled-time snapshot the
clinician confirmed. An explicit
clear appends a revision with a null focus. It does not delete earlier versions.
Do not add AI suggestions, diagnoses, readiness flags, clinical protocol content,
questionnaire results or delivered-intervention fields to this record.

Use unique constraints for session/revision and session/operation, a positive
revision check, and an ownership consistency guard against the related Session
and active Client. The application must still hold the shared active-client
lock: a database ownership check alone is not an erasure concurrency control.

The new append-ordered migration is
`20260926001100_mind_session_preparation`. It is replay-safe, bounded by
lock/statement timeouts, and adds `MIND_SESSION_PREPARATION_SAVED` to the audit
enum. It has not been applied to a database. No applied migration was modified
and no records were backfilled.

## API and concurrency contract

Introduce `GET` and `POST /api/v1/sessions/[id]/preparation`, plus shared Zod
contracts and one fail-closed encrypted-record decoder.

- Require a therapist and `BEHAVIORAL_HEALTH_DOCUMENTATION`; verify both Session
  and Client ownership. Do not make this basic authored focus depend on clinical
  analysis or therapy-guide entitlements.
- Return private/no-store responses. Reads may view historical revisions but
  must not mutate or synthesize a preparation record.
- Validate a strict, bounded body: operation ID, expected client ID, expected revision, expected
  scheduled-time identity, explicit save/clear operation, and authored body.
- For writes, acquire Client first using the existing PHI lock helper, then the
  exact Session row; reread owner, client linkage, deletion and lifecycle state.
  New saves are allowed only while `SCHEDULED`. Never attach a late asynchronous
  save to a replacement or newly selected session.
- Compare the current revision with `expectedRevision`. A conflict returns 409;
  the client keeps its draft and reviews the newest record before retrying.
- A replay with the same operation ID, expected revision and canonical body
  returns its original receipt and the current revision, without another row.
  Reusing that ID with a different payload returns 409. After authorization and
  erasure checks, look up a successful receipt before the start-state check, so
  a timed-out successful save can still be acknowledged after the visit starts.
- If the current ciphertext cannot be decrypted or validated, return a safe
  unavailable response. Never replace unreadable history with an empty record.
- Audit only IDs, revision, bounded operation/source codes and request metadata.
  Do not log focus text, raw decryption failures or model/prompt content.

Persisting preparation does not authorize processing it with AI. The existing
`MindLiveCaseContext` feature requires separate relevance review, explicit send
and gateway acknowledgement. Leave preparation out of that contract and gateway
payload for this first slice. Any later integration requires a separately tested
disclosure and review boundary.

## Required implementation files and ownership

- Database: `prisma/schema.prisma` and the new append-ordered migration.
- Contracts: new `packages/contracts/src/mind-session-preparation.ts`, its tests,
  and exports/audit/DSR additions in `index.ts`, `audit.ts`, and `dsr.ts`.
- Server: new session preparation route and `apps/web/lib/mind-session-preparation.ts`
  decoder/service, with behavioral route tests.
- UI: new `SessionPreparationPanel.tsx`; exact-session props and integration in
  `PreparePanel.tsx`, `TodaySessionCard.tsx`, and `RecordConfirmStrip.tsx`; read-only
  consumption in the ordinary session and live session pages. Coordinate with
  the owners of these currently changing files before editing them.
- Privacy: add all revisions, including clears, to `mind-care-data-export.ts` and
  its tests; add explicit deletion to `dpdp-erasure.ts`, disposition to
  `dpdp-erasure-manifest.ts`, and erasure/schema-completeness regression tests.

Keep the client `/prepare` summary API as historical context. Do not overload it
with an implicit latest-session mutation or put plaintext preparation in URLs,
browser persistent storage, audit metadata, consent snapshots or note fields.

## Acceptance and verification gates

- Two same-day visits retain different preparations; changing client/visit never
  adopts the previous draft. No silent legacy import or cross-account carry.
- No record appears until explicit adoption receives a server acknowledgement.
- A timed-out request can be retried with the same operation; concurrent/stale
  saves conflict without losing the clinician's unsaved wording.
- Successful-save retries work after start; a new post-start mutation is rejected.
- Wrong owner, doctor context, missing capability, erased Client, changed linkage
  or scheduled-time identity all fail closed. Erasure-versus-write tests cover
  both lock orderings; include a disposable PostgreSQL test before release.
- Every revision is exported through the existing authorized DSR path and erased
  under the same client lock. Encrypted retry material is not an export field.
- Corrupt/unreadable history cannot be overwritten or silently omitted.
- Opening preparation never starts capture or sends AI context. Its wording does
  not automatically become transcript, note, diagnosis or intervention evidence.
- Existing Mind manual/live consent flows, exact booking reuse and Scribe
  scheduling/token tests remain green. Real-device, database and clinical review
  remain distinct from mocked tests and static typechecking.

## Rollout and rollback

This document grants no deployment or database authority. Implement and review
the additive slice locally first; migrate only through the separately approved
release workflow, before enabling routes that require the table.

Before any preparation is stored, application rollback can leave an unused
additive table in place. **After data exists, an old application by itself is not
a sufficient rollback:** it would not know to export or erase the new PHI table.
Disable new editing/rendering while retaining the decoder, authorized export,
erasure and audit support. Do not drop the table or delete clinician records as a
rollback shortcut. Preparation storage and AI-context integration remain separate
release decisions.
