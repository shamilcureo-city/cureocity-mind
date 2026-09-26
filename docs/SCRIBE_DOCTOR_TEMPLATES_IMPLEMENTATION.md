# Doctor-specific reusable templates

## Problem and intended outcome

Scribe already has one first-visit/follow-up presentation preference per doctor, but no named
library. Doctors must repeat layout choices and document headings. This milestone adds private
named note layouts and document completion skeletons without capturing consultation content.

As a doctor, I can save several reusable layouts, choose one explicitly, preview it and apply it
without altering clinical findings. For a referral, patient summary or certificate draft, I can
append a chosen set of completion fields without replacing my existing additions.

## Requirements and acceptance

- A library belongs to one active doctor and is encrypted, never patient/session-linked.
- Named note templates contain only first-visit/follow-up heading labels, seven-section ordering
  and spacing. Every clinical field and its evidence remain available; no note rewriting occurs.
- Document skeletons contain only selected, ordered fixed prompt keys for their document type.
  They cannot store reusable clinical paragraphs, signatures or certificate assertions.
- Creating/updating a template requires an explicit no-patient-details acknowledgement. Names
  and custom headings are user-entered text: this is not automatic PHI detection. Never offer
  copying a clinical note, patient document, transcript or entered completion values into a template.
- Save, duplicate and delete are explicit. Edits/deletion use revision checks; creation retries
  reuse their operation identity. Failed saves retain local work. No automatic write retries.
- Applying a note template previews presentation only; the existing explicit style save applies
  the preference. The medical note text, prescription, source links and signature remain unchanged.
- Applying a document skeleton appends unsaved completion fields and clears current review.
  Reserved `[[Complete: ...]]` fields block review and download until completed or removed, on
  both client and server. Existing signed excerpts remain immutable.
- Template changes or deletion never retroactively rewrite an existing patient document.
- Templates are excluded from patient-specific export/erasure; patient-linked copies of completed
  additions remain covered by the existing document export/erasure path. Practitioner account
  export/erasure is not certified by this feature.
- Keep all existing Mind workflows and the current default note-style preference compatible.

## Non-goals

No clinical default findings, medications, diagnoses, automatic patient-variable substitution,
AI prompt customization, shared/public template marketplace, certificate issuance, PDF layout,
signature, sending, deployment or applied migration. Free-text document boilerplate is deferred
to avoid copying patient information or unsupported clinical assertions between encounters.

## Design plan

Keep Scribe's existing white (#ffffff), source grey (#f6f6fa), ink (#0b0c10), secondary text
(#525965), border (#e3e5ee) and warning (#985516). Fraunces is the heading face; Inter carries
controls and body copy. A left-aligned library and editor become a single column on mobile.
The memorable interaction is a faithful preview of the selected headings or blank completion
fields, not new decorative chrome. Reuse the clinical workspace's focus states and 44px controls.

    Private template list | Named layout / fixed completion fields
                          | Preview
                          | No patient details acknowledgement + Save

This extends the actual OPD workflow rather than creating a generic settings dashboard. Template
selection stays next to note styling and document additions; the clinic exposes library management.

## Verification plan and success criteria

- Contract/unit: reject duplicate/missing note fields, clinical-content keys, incompatible prompt
  types and unsupported placeholders. Built-ins contain no patient details or clinical conclusions.
- Route: own-doctor access, active lifecycle, personal null scope, bounded requests/library,
  idempotency, revision conflicts, no-store responses, minimized audit metadata and additive migration.
- Hook/UI: explicit application only, stale/failed responses, cancellation, dirty preservation,
  delete confirmation, append preserving additions and unresolved-field review/download refusal.
- Integration: library reaches note styling and consultation documents; fictional preview uses
  memory-only transport, never clinical APIs. Desktop/mobile and keyboard-visible controls checked.
- Run scoped lint/format checks, one full web TypeScript check and the web suite after integration.

Before release: review/apply migrations separately, authenticated storage/runtime checks,
real-browser download verification carried from the document milestone and clinician usability
review. Pilot targets are hypotheses: doctors can find/apply a saved template in three actions,
and no test case may change signed source text or bypass document review. Measure actual time and
template reuse during a supervised pilot; no PHI-bearing analytics are introduced here.

## Implemented scope and verification

- Doctor-only library: `/app/clinic/templates`, linked from Clinic. Private CRUD supports named
  first-visit/follow-up layouts and ordered fixed document prompts, with explicit acknowledgement.
- Note styling loads a selected template into its local preview; only an acknowledged style save
  applies presentation. All seven clinical sections remain visible, including empty sections with
  evidence and literal zero/partial vital values.
- Consultation documents append completion fields to existing additions without changing signed
  excerpts. Unfinished fields may be saved as drafts but cannot be reviewed or downloaded.
- Personal templates stay out of patient-specific DSR paths; no patient data is copied into a
  template by the UI. User-entered names/headings still depend on the doctor's acknowledgement.
- Stable create identity handles lost acknowledgements and later edits. The owner-locked create
  guard rejects an operation whose content-free delete audit already exists, preventing deleted
  templates from being resurrected at revision 1. This depends on retaining those audit entries;
  no production audit purge was found, but out-of-band database deletion is not covered.
- Fictional page-memory preview: `/dev/scribe-templates`, available only in development with
  `SCRIBE_WORKSPACE_PREVIEW=true`. No real clinical fetch fallback or browser persistence.

Browser checks exercised failed save retention and explicit retry, saved note-template selection,
preview-only changes followed by explicit presentation save, unchanged clinical text and evidence,
saved referral prompts, append preserving additions, unfinished-field draft save/review blocking,
and fresh review after removing the fields. No document was issued, signed or shared. The
390-pixel mobile layout had no horizontal overflow; desktop sizing was restored and keyboard
focus was visibly checked. This is fictional transport verification, not authenticated storage
or real-device clinical validation.

Final local checks: the full web Vitest suite passed 3,321 tests across 328 files (44 tests skipped),
and `tsc --noEmit --incremental false` passed. Scoped ESLint, Prettier and `git diff --check` passed.
The retry regression suite also covers deleted-operation refusal and a fresh create identity only
after a successfully confirmed library reload. Failed or superseded reloads keep retry identity.

Release remains separate: no commit, push, migration application or deployment was performed.
The additive `20261002000000_scribe_doctor_templates` constraint migration is unapplied, along
with the preceding local workflow migrations. Preserve the retained delete audits during release
and any future retention-policy work. Authenticated database, browser-download and clinician
usability checks remain release prerequisites.
