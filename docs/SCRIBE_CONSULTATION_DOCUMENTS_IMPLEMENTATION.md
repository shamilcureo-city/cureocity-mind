# Scribe consultation document drafts

## Outcome and boundary

A doctor can prepare a referral, patient summary and medical-certificate draft from one locked,
signed consultation. Selected drafts are stored as one encrypted packet, so they share the same
source snapshot. This is local implementation work, not a released or clinically validated feature.

No new AI calls, automatic clinical assertions, certificate issuance, signature, messaging, PDF,
insurance submission or Mind letter reuse. A certificate remains **DRAFT — NOT VALID FOR ISSUE**
even after its wording is reviewed. A signed source is not a signature on its derived documents.

## Acceptance criteria

- Only the owning active doctor can access an active patient's encounter and documents.
- A locked, signed medical note is required; a prescription is not required.
- Signed excerpts are immutable and distinguished from editable clinician additions.
- Each document is independently reviewed. Edits clear review unless the exact new wording is
  explicitly reviewed in the same save action; the server records reviewer and time.
- Source changes or unlocking preserve history but block further editing, review and download.
- Creation is atomic and retry-safe; edits use the packet revision to detect concurrent changes.
- Downloads require reviewed current wording, the exact viewed revision and patient-sharing
  capability. Every download remains a draft. There is no send or issue action.
- Failed saves preserve local edits. Navigation and document switching protect unsaved work.
- No patient information is placed in browser storage, URLs, logs or preview fixtures.
- Existing tenant encryption, audit and patient export/erasure cover the new packet kind.

## UI plan

Preserve Scribe's existing clinical design: white (#ffffff), source surface (#f6f6fa), ink
(#0b0c10), secondary text (#525965), border (#e3e5ee), warning (#985516). Fraunces headings and
Inter body copy remain unchanged. A source-state banner leads into document selection and a
single editor: signed excerpts first, clinician additions second, explicit save/review controls
last. Use 44px controls, visible focus, mobile stacking and reduced-motion support. This follows
the existing encounter workflow rather than introducing a separate application shell.

## Verification and release gates

Contract/unit tests cover source hashing, null prescription, review metadata, stale sources,
atomic/idempotent creation and revision conflicts. Route tests cover authorization, capability
gates, source checks inside lifecycle locks and draft-only downloads. Hook/UI tests cover
scope changes, malformed acknowledgements, delayed responses, dirty work and failure recovery.
A development-only, fictional memory-backed preview exercises desktop and narrow layouts.

Run the web type check and suite after focused checks. The additive database constraint migration
must be reviewed and deployed separately with the earlier pending workspace migrations; do not
apply it during local UI work. Authenticated database/runtime testing and qualified clinician
review remain release gates. Doctor-specific reusable templates are a later milestone.

## Local verification result — 2026-09-26

- Web suite: 322 files passed; 3,171 tests passed and 44 skipped.
- Web TypeScript check (`tsc --noEmit --incremental false`) passed; scoped ESLint,
  Prettier and diff checks passed.
- Fictional browser preview checked creation, failed-save preservation, explicit per-document
  review, changed-source invalidation, unlocked-source read-only history, desktop layout and
  390px mobile layout without horizontal overflow.
- The browser automation download-event check timed out, so delivery of a downloaded file was
  not confirmed in the browser. Route/hook/in-memory integration tests cover draft text, headers,
  current-source/revision/review checks and download handoff; a real-browser download smoke check
  remains required.
- No database migration, authenticated database/runtime validation, production deployment,
  clinical sign-off, signature or document issuance was performed.

Preview: `/dev/scribe-documents` (development and `SCRIBE_WORKSPACE_PREVIEW=true` only).
The encounter's **Consultation tools → Consultation documents** entry uses authenticated APIs;
the preview uses fictional page-memory data and cannot make clinical API calls.
