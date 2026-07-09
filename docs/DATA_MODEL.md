# Data model — the shared schema backbone

A prose guide to `prisma/schema.prisma` (~2,700 lines, ~70 models + enums).
This explains the **entities everything hangs off**, what's shared vs
vertical-specific, and the **Session lifecycle**. It is a map, not a field
dictionary — `schema.prisma` is the source of truth for exact columns.

Conventions that apply almost everywhere:

- **Tenancy.** Nearly every row carries `psychologistId`; every query filters
  by it. There are no records shared across practitioners.
- **Soft delete.** Client (and several others) have `deletedAt`; all
  list/get queries filter `deletedAt: null`. Archiving a client sets it.
- **PII is encrypted.** `Client.fullNameEncrypted / contactPhoneEncrypted /
contactEmailEncrypted` are the sole store (the plaintext columns were
  dropped, S32 Phase 2). Read only through `apps/web/lib/client-pii.ts`.
- **`@@map`.** Models map to snake_case tables (`Session` → `sessions`).
  Check the `@@map` before writing raw SQL in a migration.

## 1. The core spine

Read these five and you understand 80% of the app:

```
Psychologist ──1:N──▶ Client ──1:N──▶ Session ──1:1──▶ NoteDraft ──(sign)──▶ TherapyNote
   (the practitioner —      (the patient —       (one encounter)   (working note)   (signed, immutable-ish)
    THERAPIST or DOCTOR)     shared by both
                             verticals)
```

- **`Psychologist`** — the practitioner account (the name is therapist-era;
  it serves both verticals). Carries `vertical: PractitionerVertical`,
  `role`, `status`, onboarding fields (`rciNumber` for therapists,
  `medicalRegNumber` + `specialty` for doctors), `defaultModality`,
  `defaultCaptureMode`, billing linkage, and WebAuthn credentials.
- **`Client`** — the patient, **shared by both verticals**. PII in the
  `*Encrypted` columns; `dateOfBirth`, `status: ClientStatus`
  (`ACTIVE | PAUSED | DISCHARGED | TRANSFERRED`), `preferredLanguage`,
  `spokenLanguages[]`, `presentingConcerns`, `isDemo`, `deletedAt`,
  `abhaAddress` (doctor ABDM linkage).
- **`Session`** — one encounter. The join point for everything clinical
  (see §2). The only structural **doctor markers** on a session are
  `tokenNumber` (OPD queue token) and `captureMode`.
- **`NoteDraft`** — the working note (`status: NoteDraftStatus`), holds the
  generated note `content`, the `rxPad` (doctor), and the encrypted
  `transcriptEncrypted`. One per session.
- **`TherapyNote`** — the signed note (WebAuthn-gated). Snapshots the note +
  `rxPad` at sign time; `NoteEdit` rows track post-sign revisions.

## 2. Session — the lifecycle state machine

`Session.status: SessionStatus`:

```
                 ┌────────── CANCELLED
                 │
 SCHEDULED ──────┼────────── NO_SHOW
     │           │
     │           └────────── RESCHEDULED
     ▼
 IN_PROGRESS  (capture started — live-token route for doctors; recording start for therapists)
     │
     ▼
 COMPLETED   (note finalized/signed; endedAt set)
```

Two more discriminators, both set server-side at create time (therapists
can't override them):

- **`kind: SessionKind`** = `INTAKE | TREATMENT | REVIEW` — inferred from
  cumulative state; drives Pass 2/3 prompt branches (intake note vs SOAP vs
  review-with-verdict).
- **`modality: SessionModality?`** (nullable) — CBT / EMDR / ACT / IFS /
  PSYCHODYNAMIC / MI / MBCT / SUPPORTIVE / INTAKE / OTHER, picked by the
  `session-defaults.ts` cascade.
- **`captureMode: CaptureMode?`** = `LIVE | DICTATE | UPLOAD` — doctor
  vertical; written at capture start.

`Session` fans out to: `AudioChunk[]`, `TranscriptSegment[]`,
`GeminiCallLog[]`, `NoteDraft?`, `TherapyNote?`, `ClinicalReport?`,
`TreatmentPlan[]`, `ClientDiagnosis[]`, `PatientShare[]`,
`InstrumentResponse[]`, `SafetyPlan[]`, and (doctor) `MedicationOrder[]`,
`ClinicalOrder[]`, `Differential?`, `ClinicalReading[]`.

## 3. Entity groups

### Identity & tenancy

`Psychologist`, `WebAuthnCredential` (passkeys for sign-off), `Clinic` +
`ClinicMembership` (multi-therapist orgs), `PilotInviteCode`,
`PsychologistTenantKey` (**the per-tenant DEK store** — wrapped data keys for
PII envelope encryption; see `packages/crypto`).

### Client, consent & DPDP data-subject rights

`Client`, `Consent` (scoped grants: audio / AI-note / cross-border …),
`ClientClaimToken` (patient-portal claim), `ClientPushSubscription`,
`ClientNomination`, `ClientErasureRequest` (DPDP right to erasure — gated
admin fulfilment), `ClientGrievance`. `IntakeSubmission` + `Booking` feed
new clients in.

### Recording & transcription

`Session`, `AudioChunk` (metadata; body in Vercel Blob/S3),
`TranscriptSegment` (per-segment transcribe-on-arrival).

### Notes

`NoteDraft`, `TherapyNote`, `NoteEdit` (per-field post-sign revisions),
`NoteReview`, `NoteTemplate` (custom note structures).

### Clinical — diagnosis, plan, measurement

`ClinicalReport` (Pass 3 output), `ClientDiagnosis` + `TreatmentPlan`
(confirmed, cumulative), `TreatmentGoalProgress` (side table keyed by
`(treatmentPlanId, goalIndex)` — toggling a goal never re-versions the plan),
`TreatmentEpisode` (`OPEN → DISCHARGED | TRANSFERRED`), `AssessmentItem`,
`InstrumentResponse` (PHQ-9 / GAD-7 scores → reliable-change engine),
`ProblemListItem` + `SessionProblemLink`, `CaseConsult`,
`ClientConceptualMap`, `SafetyPlan`.

### Therapist AI artefacts & engagement

`TherapyScript` (Pass 4, cached), `PreSessionBrief` (Pass 5, cached),
`ModalityState` + `ModalityTransition` + `EmdrTarget` (modality workflow),
`MoodLog`, `JournalEntry`, `ExerciseAssignment`, `Letter`.

### Doctor vertical

`LiveConsultMetric` (per-consult tokens / INR / latency, incl. DOC-9
speech→transcript percentiles), `MedicationOrder` + `ClinicalOrder`
(`status: OrderStatus`, DRAFTED → CONFIRMED / DISCARDED), `Differential`
(Pass 9 reasoning), `ClinicalReading` (chronic-disease measures —
`ChronicMeasure`, reuses the Journey engine).

### Patient-facing sharing

`PatientShare` — the canonical shared artefact (`artefactType:
PatientShareArtefactType`, `channel`, `status`, a frozen `snapshot` JSON).
The portal `/p/[token]` renders these; WhatsApp/email link to it.

### Billing & growth

`BillingAccount` (`plan: BillingPlan`, `status`), `BillingPayment`,
`ReferralCode` + `ReferralRedemption`.

### Observability & audit

`GeminiCallLog` (one row per pass call: `pass: GeminiPass`, status, tokens,
region, cost), `AuditLog` (`action: AuditAction`, `actorType` — **every
state change writes one**; a chaos test enforces coverage).

## 4. Key enums to know

| Enum                       | Values (abridged)                                                                | Drives                                |
| -------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| `PractitionerVertical`     | `THERAPIST`, `DOCTOR`                                                            | the whole vertical split              |
| `SessionStatus`            | `SCHEDULED · IN_PROGRESS · COMPLETED · CANCELLED · NO_SHOW · RESCHEDULED`        | encounter lifecycle                   |
| `SessionKind`              | `INTAKE · TREATMENT · REVIEW`                                                    | Pass 2/3 prompt branch                |
| `SessionModality`          | CBT · EMDR · ACT · IFS · PSYCHODYNAMIC · MI · MBCT · SUPPORTIVE · INTAKE · OTHER | recommender + competency              |
| `CaptureMode`              | `LIVE · DICTATE · UPLOAD`                                                        | doctor capture path                   |
| `GeminiPass`               | `PASS_1…8` + `PASS_9_DIFFERENTIAL · PASS_10_FINDINGS · PASS_11_REASONING`        | call metering + routing               |
| `ClientStatus`             | `ACTIVE · PAUSED · DISCHARGED · TRANSFERRED`                                     | roster                                |
| `TreatmentEpisodeStatus`   | `OPEN · DISCHARGED · TRANSFERRED`                                                | care arc / discharge                  |
| `OrderStatus`              | DRAFTED → CONFIRMED / DISCARDED                                                  | doctor Rx + orders                    |
| `PatientShareArtefactType` | SOAP note, progress report, RX_PAD, …                                            | portal render + share builder         |
| `AuditAction`              | ~120 literals                                                                    | the audit trail (chaos-test enforced) |

## 5. Where to change the schema

Follow **[`CLAUDE.md`](../CLAUDE.md)** §4 (per-sprint idempotent migrations),
§5 (add a Gemini pass), §6 (add an audit action), and the "Critical files"
table (§10) for the specific contract + mapper + route touchpoints. Never
edit an already-applied migration — fix forward in a new guarded one.
