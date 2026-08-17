# Cureocity ORBIT — convergence status

Last updated: 2026-08-15

## Program status

| Sprint                      | Status          | Delivered / exit condition                                                                                                   |
| --------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0 — Product lock            | **Complete**    | Charter, glossary, capability matrix, architecture decision, and scope are recorded.                                         |
| 1 — Architecture foundation | **Complete**    | Canonical domain types, branded IDs, legacy adapters, repository ports, and boundary tests exist in `@cureocity/orbit-core`. |
| 2 — Capability model        | **Complete**    | Credentials, capabilities, migration/backfill, resolver, guards, and denial auditing.                                        |
| 3 — Brand convergence       | **Complete**    | Central brand source, responsive ORBIT assets, and active customer-facing brand surfaces.                                    |
| 4 — Unified shell           | **Complete**    | One capability-aware navigation, Today home, and New Encounter action.                                                       |
| 5 — Patient roster          | **Complete**    | Canonical patient UI/API routes, compatibility adapters, and redirects.                                                      |
| 6 — Patient workspace       | **Complete**    | Unified overview, timeline, documents, care, measures, and shares.                                                           |
| 7 — Encounter foundation    | **Complete**    | Shared lifecycle, encounter profiles, state machine, and capture strategies.                                                 |
| 8 — Behavioral Health Pack  | **Complete**    | Register current therapy functionality behind workflow-pack interfaces.                                                      |
| 9 — Medical Care Pack       | **Complete**    | Register medical/live functionality behind workflow-pack interfaces.                                                         |
| 10 — Backend convergence    | **Complete**    | Application services, thin live routes, transactional audits, and integration tests.                                         |
| 11 — Legacy retirement      | **In progress** | Capability page guards replace doctor-only guards; compatibility removal awaits measured zero usage.                         |
| 12 — Launch hardening       | **In progress** | Automated fail-closed configuration gates and launch runbook delivered; rehearsals and sign-offs remain.                     |

## Delivered in Sprints 1–2

- Canonical `Practitioner`, `Patient`, and `Encounter` types without renaming persistence tables.
- Branded identifier types to prevent accidental practitioner/patient/encounter ID interchange.
- Explicit compatibility adapters from `Psychologist`, `Client`, and `Session`.
- Transitional encounter-profile derivation for behavioral-health and medical records.
- Tenant-scoped repository ports that require practitioner scope on patient and encounter reads.
- Architecture tests preventing ORBIT core from importing Next.js, Prisma, Firebase, NestJS, Vercel,
  or web application internals.
- Compatibility tests for therapist, doctor, patient, and encounter mappings.
- Profession, credential kind/status, capability, and grant-source contracts.
- Additive credential and capability persistence with legacy profession, credential, and access
  backfills.
- Effective-capability resolution that rejects inactive/expired authority and keeps prescription
  drafting separate from credential-gated signing.
- Authenticated API context now exposes resolved profession and capabilities.
- Server-side capability guards protect medication confirmation, clinical orders, differential,
  FHIR export, ABDM push, and medical-order reads.
- Capability denials return 403 and write `CAPABILITY_ACCESS_DENIED` audit evidence.

## Delivery and pending-work detail

### Delivered in Sprint 4 — Unified shell

- One navigation model now drives desktop and mobile: Today, Patients, Encounters, ORBIT Assistant,
  Analytics, and supporting destinations.
- Today is the authenticated home; `/app` is a compatibility redirect.
- Recording moved from a primary navigation destination to the New Encounter action at
  `/app/encounters/new`.
- Patient and encounter links select current compatibility routes through capabilities rather than
  separate therapist/doctor navigation arrays.
- The Today agenda supports both behavioral-health session routes and medical encounter routes.
- Dashboard remains the Analytics compatibility destination until its content is renamed in the
  patient-workspace program.

### Delivered in Sprint 5 — Patient roster

- `/app/patients` is the canonical roster for every practitioner capability set, with shared search,
  status filters, cursor pagination, and Patient vocabulary.
- `/app/clients` preserves filters while redirecting to the canonical roster.
- `/api/v1/patients` and `/api/v1/patients/:id` are the canonical list, create, read, and update
  resources; persistence and audit enum names remain stable during the additive migration.
- Legacy base and detail Client APIs delegate to Patient handlers and advertise deprecation,
  sunset, successor-version, and compatibility headers.
- New Patient creation and internal roster links now use canonical Patient URLs.
- Patient detail remains a capability adapter over the existing behavioral and medical views until
  Sprint 6 supplies the unified longitudinal workspace.

### Delivered in Sprint 6 — Patient workspace

- `/app/patients/:id` is one tenant-scoped workspace for behavioral, medical, and multidisciplinary
  practitioners; legacy Client detail URLs redirect to it.
- Overview, Timeline, Care, Measures, and Shares use a common information architecture and a single
  Patient identity header.
- Resolved capabilities compose behavioral treatment/safety plans, medical orders/chronic care, or
  both without changing the Patient route.
- The timeline links into current behavioral or medical encounter adapters until Sprint 7 converges
  their lifecycle and URLs.
- Patient editing, check-ins, data rights, and shared-item history remain available in the canonical
  workspace.

### Confidentiality boundary carried forward

- Resolve multidisciplinary confidentiality before enabling organization-wide record visibility.

### Delivered in Sprint 7 — Encounter foundation

- A framework-independent state machine defines start, complete, cancel, no-show, and reschedule
  transitions, including terminal-state rules.
- Behavioral and medical Encounter profiles register supported batch ambient, live stream,
  dictation, manual, and upload capture strategies.
- Existing start, complete, and no-show handlers now enforce the shared state machine rather than
  duplicating route-specific status checks.
- `/api/v1/encounters` and `/api/v1/encounters/:id` provide canonical create/read adapters, with
  canonical start, complete, and no-show transition endpoints.
- Production Session persistence and audit names remain stable while behavioral and medical packs
  migrate onto the Encounter foundation.

### Delivered in Sprint 8 — Behavioral Health Pack

- A framework-independent workflow-pack contract registers encounter profiles, capture strategies,
  typed documents, optional panels, measures, and safety policies.
- The Behavioral Health Pack registers intake, follow-up, and review profiles plus batch ambient,
  dictation, manual, and upload capture.
- Intake notes, therapy notes, clinical reports, treatment plans, and safety plans remain distinct
  clinician-confirmed document kinds.
- Case formulation, therapy workflow, measures, safety planning, and Patient sharing panels are
  materialized only when their required capabilities are effective.
- PHQ-9 and GAD-7 are registered as the initial measurement-based-care instruments.
- `/api/v1/psychologists/me/workflow-packs` exposes the effective pack manifest to future shell and
  encounter clients without leaking unavailable panels.

### Delivered in Sprint 9 — Medical Care Pack

- The Medical Care Pack registers consult and follow-up profiles with live stream, dictation,
  manual, and upload capture strategies.
- Medical notes, differential assessments, medication orders, and clinical orders remain distinct
  clinician-confirmed document kinds.
- Medical note, differential, medication drafting, prescription signing, clinical orders, chronic
  care, FHIR, and ABDM panels are independently capability-filtered.
- Prescription signing remains separate from drafting authority, and external exports require
  explicit clinician confirmation.
- Blood pressure, blood glucose, and HbA1c are registered as initial chronic-care measures.
- FHIR R4 and ABDM integrations are independently materialized from their effective capabilities.
- Multidisciplinary practitioners receive both Behavioral Health and Medical Care pack manifests.

### Delivered in Sprint 10 — Backend convergence

- Start, complete, and no-show use cases now run through a framework-independent Encounter
  application service with stable error codes.
- Ownership, consent, lifecycle transitions, document-draft creation, and audit-event construction
  live outside the HTTP and Prisma adapters.
- The Prisma adapter executes the read, conditional state mutation, draft creation, and audit write
  in one transaction and rejects concurrent state changes.
- Canonical Encounter routes authenticate, validate transport input, call the application service,
  and map stable errors; they contain no direct Prisma, transaction, or audit logic.
- Legacy Session transition routes are compatibility-only delegates to canonical Encounter routes.
- Application tests cover success, consent denial, invalid state, cross-tenant non-disclosure,
  document-draft creation, and rollback when audit persistence fails.
- Route architecture tests prevent business logic from drifting back into HTTP adapters.

### Sprint 11 — Legacy retirement (rollout in progress)

- Medical encounter pages now authorize through effective capabilities instead of the legacy Doctor vertical.
- The shared demo identity is prohibited in every production runtime, including accidental `AUTH_BYPASS=true` deployments.
- Canonical Patient and Encounter navigation remains primary and compatibility endpoints retain machine-readable sunset headers.
- Final removal of nested Client APIs and persistence adapters is deliberately gated on measured zero compatibility traffic; removing them without that evidence would violate the migration safety rule.

### Sprint 12 — Launch hardening (engineering gates delivered; operational gates pending)

- A pure production-readiness policy and CLI reject authentication bypass, incomplete Firebase Admin, local KMS, missing Google Cloud KMS key, unpinned WebAuthn, weak ticket secrets, and mock billing.
- Authentication bypass, WebAuthn origin validation, and registration tickets now fail closed in production at their runtime boundaries.
- The launch runbook defines behavioral-health, medical, multidisciplinary, and privacy E2E journeys plus migration, rollback, restore, key-rotation, outage, and incident rehearsals.
- Production launch remains blocked until those rehearsals are executed and clinical, security, privacy/DPO, and platform owners attach signed evidence. Code cannot truthfully manufacture those external approvals.

## Known constraints carried forward

- Legacy persistence and API names remain intentionally stable during the additive migration.
- `PractitionerVertical` remains in legacy page guards and prompt selection until Sprints 8, 9, and
  11 replace those compatibility branches.
- Legacy medical registration rows are backfilled as pending credentials; prescription signing is
  deliberately unavailable until verification changes the credential status to `VERIFIED`.
- One product does not grant clinic-wide access; confidentiality boundaries remain explicit.
- The web application still needs production-path component, route integration, and E2E coverage.
