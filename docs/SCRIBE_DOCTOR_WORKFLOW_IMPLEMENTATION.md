# Doctor workflow extensions

## Scope and outcome

Implement all eight requested conveniences in the existing Scribe workflow. The outcome is less repeated entry and easier review, not additional autonomous clinical decisions. This is local implementation; production deployment, database migration execution, real-device evaluation and clinician acceptance remain separate gates.

## Acceptance checklist

- [x] My favourites: durable doctor-owned medicine, investigation, advice and phrase shortcuts; preview before insertion, patient-specific prescribing confirmation. Grouped sets contain at most five items and apply atomically; medicines enter as pending.
- [x] Patient at a glance: dated signed encounter context, medication provenance, allergies and trends; unknown is never rendered as none. Latest intake remains labelled self-reported, with dated readings.
- [x] Doctor-specific note styles: first-visit/follow-up heading order, labels and spacing without adding findings or dropping evidence. This changes presentation, not AI generation or PDF layout.
- [x] Preparation: 24-hour, revocable, single-use write-only intake links; unverified author identity labelled; doctor review before chart use. Link changes clear the old form and isolate in-flight submissions.
- [x] Report reading: bounded private PDF/image upload, source preview and extracted candidate values with units/dates; explicit review; no automatic clinical-record updates. Five-record pagination bounds original-file decryption.
- [x] Quick corrections: typed explicit actions with preview and undo; keyboard access; no signing/sending from ambient speech. Existing voice prescription editing is preserved, not newly expanded.
- [x] Pending work: unsigned notes and doctor-owned result/referral/follow-up tasks with due date and completion state. Responsibility is a label, not delegated access or automatic notifications.
- [x] Patient instructions: signed-source-bound instructions, separate clinical/language confirmation, reviewed text download only. Medication directions remain exactly as signed and read-only; advice, investigations and follow-up can be translated. Nothing is sent automatically.

## Safety and persistence

New workflow bodies are envelope-encrypted per tenant. Patient/session linkage is checked on the server and in storage. Writes share the active-patient lifecycle lock with erasure. Optimistic revisions reject stale edits. New patient data is included in access exports and erased with the patient, including uploaded originals and intake credentials. Do not put patient content or intake tokens into localStorage, application logs or audit metadata. Shared shortcuts must contain reusable text, not a patient's history.

## Design plan

Preserve the current clinical workspace rather than introduce a new visual system. Use paper white (#ffffff), the existing pale workspace (#f6f6fa), dark text (#0b0c10), readable secondary slate (#525965), structural grey (#e3e5ee), and focus blue (#304c80). Retain existing sans-serif control/body typography and restrained serif patient headings. Keep text left-aligned and controls at least 44px high. Use disclosure panels inside preparation, note/Rx review and patient handoff; the consultation itself remains the main surface. On mobile, stack source and draft without horizontal scrolling. Status colours convey confirmed/unconfirmed/error states only.

Plan critique: eight equal dashboard tiles would compete with the consultation. Instead, put each tool at the point it is needed and keep uncommon actions collapsed. No new hero, animation or decorative metrics.

## Verification plan

Unit and route tests cover validation, ownership/capability denial, encrypted storage, stale revisions, erased patients, signed-note immutability, single-use/revoked/expired intake grants, source-bound instruction review and unconfirmed report values. Privacy tests cover export and erasure. Typecheck, lint and formatting cover every changed file. Fictional local previews are checked on desktop/mobile and keyboard. External extraction and authenticated clinical use are reported as unverified until exercised under approved configuration with fictional or appropriately consented data.

## Explicit non-goals

No new hospital/ABDM integration, automatic prescribing, background signing, automatic patient sending, public chart access or production release in this task. These were not part of the eight-feature implementation approval. A presentation preference is not a claim that AI generation has been personalised unless the generation path is actually wired and tested.

## Verification completed — 25 September 2026

- Full web suite: **301 files passed, 2,709 tests passed, 44 opt-in tests skipped**. The Scribe PostgreSQL tests were then run separately, not counted as covered by skipped cases.
- Isolated PostgreSQL: **8/8 passed**, exercising real database triggers, locks, concurrent revision conflict, tenant/session scope, suspension and erasure serialization. Crypto and identity use fictional test fixtures; this is not real KMS/Firebase validation.
- New additive migration applied and replayed successfully on the disposable database. Other schema objects were initialized with `db push`; this does **not** prove replay of the complete historical migration chain.
- Migration checker: **21/21 passed**, with replay-safe DDL and index-name scans passing.
- Contracts build, combined web TypeScript check, ESLint on all changed web TS/TSX files, formatting and whitespace checks passed. Final full suite and typecheck used bundled Node **24.19.0**, which satisfies the declared engine requirement; the default Node **22.22.3** is below the requirement and must not be used for release preflight.
- Browser preview checked at 1,365px desktop and 390px mobile. All four workflow stages fit the mobile viewport without horizontal overflow. Exercised favourite insertion, correction preview/apply/undo, saved heading style, intake reconciliation, task completion, original-image review and separate instruction approvals.
- Prescription PATCH now applies to the freshly locked draft, optionally checks the displayed pad snapshot, rejects stale edits/signing races, and exposes safe retry/read-only states. Tests cover these cases.

The local preview at `/dev/scribe-live` contains fictional in-memory data only. It is unavailable in production and does not activate a microphone or call real patient/model APIs. Image originals are served by a development-only fixture route.

## Remaining release gates

No commit, push, migration against a shared database or deployment was performed for these extensions. Before a separate authorized release:

1. Review the diff and additive migration against the exact release target; run production build/CI and apply the approved migration.
2. Validate authenticated doctor journeys against real tenant encryption, consent/capability configuration, export/erasure and concurrent-window behavior in an isolated staging environment.
3. Exercise actual configured Vertex extraction and each supported translation language using fictional or appropriately consented documents. Model outputs were stubbed in tests; no external AI call was made here.
4. Validate native PDF rendering/open-original fallback and real-device accessibility/audio. PDF parsing/security bounds are tested; native PDF viewer behavior was not visually validated in this pass.
5. Obtain qualified clinician review before a patient-facing pilot. PDF processing still runs inside the application process; size/page/object bounds are not an OS-level parser sandbox. Broader upload rollout should consider worker isolation and resource limits.
