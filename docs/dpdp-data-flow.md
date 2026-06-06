# DPDP Data Flow — Cureocity Mind

Status: published Sprint 9. Owner: data-protection officer (DPO) once
appointed; until then, this document is the authoritative reference
clinicians and admins use to answer regulator RFIs under the Digital
Personal Data Protection Act, 2023 (India).

## 1. Roles under the DPDP Act

| DPDP role       | Cureocity Mind party                   | Notes                                                                                                                                 |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Data Principal  | Client (patient)                       | Owns the right to access/correct/erase.                                                                                               |
| Data Fiduciary  | Cureocity Mind (the platform operator) | Determines purpose + means of processing.                                                                                             |
| Data Processor  | Google Vertex AI (Gemini Flash, Pro)   | Processes transcript on behalf of the Fiduciary. Bound by GCP DPA + DPDP Schedule.                                                    |
| Data Processor  | AWS S3 (Mumbai region)                 | Stores audio + PDFs in-country only.                                                                                                  |
| Data Processor  | WATI (WhatsApp Business)               | Delivers treatment-plan PDFs. India-resident.                                                                                         |
| Data Processor  | Twilio, SendGrid                       | Outbound SMS + email fallbacks. Bound by their DPAs.                                                                                  |
| Consent Manager | Not used in V1                         | When a regulator-authorised Consent Manager registry is operational, the patient-model-service Consent table is the migration target. |

## 2. Personal data categories + retention windows

| Category           | Examples                                 | Where it lives                                                       | Encryption (gap G10)                    | Retention                                                                                            |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Identity           | name, RCI number                         | `psychologists`, `clients`                                           | Plaintext (low sensitivity)             | Active + 7y post-discharge (RCI clinical record requirement).                                        |
| Contact PII        | phone, email                             | `clients.contactPhone[Encrypted]`, `contactEmail[Enc.]`              | AES-256-GCM, per-tenant DEK             | Same as Identity.                                                                                    |
| Session audio      | 16 kHz PCM chunks                        | S3 `cureocity-mind-audio` (Mumbai)                                   | KMS bucket key (server-side AES)        | **30 days hard delete** (continuity-service `AudioRetentionService`). Test: Sprint 9 PR 4 cron mock. |
| Transcript         | text Pass-1 output                       | `note_drafts.transcript[Encrypted]`                                  | AES-256-GCM, per-tenant DEK             | Joined to TherapyNote retention (active + 7y).                                                       |
| Therapy note       | signed SOAP + risk flags                 | `therapy_notes`                                                      | JSON column; PII low after de-id        | Active + 7y. Immutable post-sign.                                                                    |
| NoteEdit history   | before/after of every signed-note edit   | `note_edits`                                                         | Plaintext (audit trail integrity)       | Same as therapy_notes.                                                                               |
| Journal entries    | client-private reflections               | `journal_entries.content[Encrypted]`                                 | AES-256-GCM, per-tenant DEK             | Client-controlled — erasure on DSR request fulfils within 30 days.                                   |
| Mood logs          | 0..10 rating + optional note             | `mood_logs`                                                          | Plaintext (low sensitivity)             | Same as Journal.                                                                                     |
| Exercise responses | structured + free text                   | `exercise_assignments.response`                                      | JSON column                             | Same as Journal.                                                                                     |
| Audit log          | every state-changing action              | `audit_logs`                                                         | Plaintext (integrity > confidentiality) | Active + 10y (regulator + grievance window).                                                         |
| Consent records    | scope, script-version, granted/withdrawn | `consents`                                                           | Plaintext                               | Active + 10y (proof of lawful basis).                                                                |
| Push subscriptions | Web Push endpoint + keys                 | `client_push_subscriptions`                                          | Plaintext (revocable)                   | Until revokedAt + 90d, then hard delete.                                                             |
| DSR rows           | nominations, erasures, grievances        | `client_nominations`, `client_erasure_requests`, `client_grievances` | Plaintext (legal evidence)              | Active + 10y.                                                                                        |
| Clinical brief     | Pass 3 output + per-section confirmation | `clinical_reports`                                                   | JSON column (transcript quotes inside)  | Same as therapy_notes (active + 7y).                                                                 |
| Client diagnoses   | cumulative confirmed ICD-11 entries      | `client_diagnoses`                                                   | JSON supporting quotes                  | Active + 7y. Supersedable, never deleted.                                                            |
| Treatment plans    | versioned confirmed plans                | `treatment_plans`                                                    | JSON                                    | Active + 7y. Supersedable.                                                                            |
| Therapy scripts    | Pass 4 cached output                     | `therapy_scripts`                                                    | JSON                                    | Cache; can be safely deleted on regenerate.                                                          |
| Patient shares     | snapshot at share time + delivery state  | `patient_shares`                                                     | JSON snapshot                           | Default 30d portal expiry; row retained for audit (active + 10y).                                    |
| Pre-session briefs | Pass 5 cached output                     | `pre_session_briefs`                                                 | JSON                                    | Cache; regenerates per new session.                                                                  |
| Instrument scores  | PHQ-9 / GAD-7 administrations            | `instrument_responses`                                               | JSON answer map                         | Active + 7y (clinical record).                                                                       |
| Safety plans       | Stanley & Brown 5-step crisis plans      | `safety_plans`                                                       | JSON                                    | Active + 7y. Supersedable.                                                                            |

## 3. Data flow diagram (text form)

```
Therapist (PWA)            Client (PWA)              Backend (Mumbai)             External
+-----------+              +-----------+             +----------------+           +----------------+
| sign up   |              | claim QR  |             | patient-model  |           |                |
| Firebase  +------------->| Firebase  +------------>|   /clients     |           |                |
| OTP       |              | OTP       |             |   /consents    |           |                |
+-----------+              +-----------+             |   /dsr/*       |           |                |
                                                     +-------+--------+           |                |
                                                             |                    |                |
+-----------+                                                |                    |                |
| consent   +------------------------------------+           |                    |                |
| (5 scopes)|                                    v           v                    |                |
+-----------+                            +----------------+----------------+      |                |
                                         | scribe-service               OO|      |                |
+-----------+                            |   /sessions/{id}/start          |     |                |
| record    +--audio chunks--+---------->|   /audio/{id}/chunks            |     |                |
| (worklet) |                |           |   /sessions/{id}/end            |     |                |
+-----------+                |           +------+--------------------------+      |                |
                             |                  |                                  |                |
                             v                  | de-identified transcript        |                |
                       +-----------+            +--------------------------------->| Vertex AI      |
                       | S3 audio  |                                               | Pass 1 + Pass 2|
                       | Mumbai 30d|                                               | (global Pro;   |
                       +-----------+                                               | asia-south1    |
                                                                                   | Flash)         |
+-----------+                                                                      +--------+-------+
| review +  |<--------------------- TherapyNote ---------------------------------------------+
| sign      |                                                                                |
| WebAuthn  +---->/sessions/{id}/sign---+                                                   |
+-----------+                          v                                                    |
                                  note_edits +                                              |
                                  therapy_notes                                             |
                                       |                                                    |
                                       +--PDF--> pdf-generator-service ---> WATI (WhatsApp) |
                                                              + SendGrid + Twilio fallbacks |
                                                                                            |
+-----------+                                                                              |
| client    |<--Web Push----+ continuity-service                                            |
| home      |               | /me/exercises, /me/mood-logs, /me/journal-entries             |
+-----------+               | /me/next-session, /me/push-subscriptions                      |
                            | /me/dsr/{data-export,profile,nominations,                     |
                            |          consent-withdrawals,grievances,erasure-requests}     |
                            +-----------------------------------------------------------------+
```

## 4. Cross-border processing (DPDP § 16)

- **Audio chunks: never leave India.** S3 bucket `cureocity-mind-audio` is region-locked to `ap-south-1`.
- **Pass 1 (transcribe + diarize)**: Gemini Flash in `asia-south1`. India-resident.
- **Pass 2 (note generation)**: Gemini Pro (currently global). Input is the de-identified transcript only — no audio, no identifiers (clientId scrubbed to `<patient>` per `@cureocity/llm` Pass 2 prompt). Cross-border consent (`CROSS_BORDER_PROCESSING` scope) is mandatory before any session is processed.
- **WATI**: Mumbai-resident. WhatsApp Business templates do not include client identifiers in the template text; only first name + treatment plan URL.

When the Central Government issues a § 16(1) jurisdiction list restricting outflow, the only adjustment needed is to swap Pass 2 to a regional Pro endpoint (planned). The architecture already separates Pass 1 and Pass 2 backends, so the swap is a single environment variable + circuit-breaker reroute.

**Sprint 13-17 update — additional global passes:** Pass 3 (Clinical Analysis), Pass 4 (Therapy Script), and Pass 5 (Pre-Session Brief) all run on Gemini Pro in the same global region as Pass 2. Their inputs are de-identified text only (transcript + note + structured client history) — the same `CROSS_BORDER_PROCESSING` consent that covers Pass 2 covers them. Each pass is wired through `ModelRouter` as a distinct backend so a future regional swap can be done per-pass via `VERTEX_CLINICAL_MODEL` / `VERTEX_THERAPY_SCRIPT_MODEL` / `VERTEX_BRIEF_MODEL` env vars (see `docs/SETUP.md`).

**Sprint 15 update — patient sharing:** outbound channels are WATI (WhatsApp, India-resident) and SendGrid (email). The `/p/<token>` patient portal is served from the same Vercel deployment as the therapist app; it has no external dependency. Snapshots are locked in `patient_shares.snapshot` at share time so the patient view is stable even if the source row is later edited or erased.

## 5. Data subject rights (DPDP §§ 11–15)

| Right                 | Endpoint                                  | Audit action(s)                                   | SLA         |
| --------------------- | ----------------------------------------- | ------------------------------------------------- | ----------- |
| § 11 Access           | `GET  /api/v1/me/dsr/data-export`         | `DSR_ACCESS_FULFILLED`                            | 30 days max |
| § 12 Correction       | `PATCH /api/v1/me/dsr/profile`            | `DSR_CORRECTION_REQUESTED`                        | 30 days max |
| § 13 Nomination       | `POST /api/v1/me/dsr/nominations`         | `DSR_NOMINATION_RECORDED`                         | Immediate   |
| § 13 Withdraw consent | `POST /api/v1/me/dsr/consent-withdrawals` | `DSR_CONSENT_WITHDRAWN` + `CONSENT_WITHDRAWN`     | Immediate   |
| § 14 Grievance        | `POST /api/v1/me/dsr/grievances`          | `DSR_GRIEVANCE_FILED`                             | 7 days ack  |
| § 15 Erasure          | `POST /api/v1/me/dsr/erasure-requests`    | `DSR_ERASURE_REQUESTED` → `DSR_ERASURE_FULFILLED` | 30 days max |

All six are implemented in `patient-model-service/src/dsr/`. The admin role (gap G9) consumes the open queue and resolves requests; status transitions are recorded in the corresponding row plus `audit_logs`.

## 6. Audit log + admin review (gap G9)

- Every state-changing endpoint writes one `audit_logs` row. The list of audit actions is enumerated in `packages/contracts/src/audit.ts` (`AuditActionSchema`).
- **Audit coverage test**: `packages/contracts/src/audit-coverage.spec.ts` parses every service's source tree and asserts each `AuditAction` enum value has at least one writer site somewhere in the codebase. Failing this test means a regulator could ask "where is action X audited?" and the codebase has no answer.
- **Admin audit-log read**: `GET /api/v1/admin/audit-logs` returns a filtered + cursor-paginated slice. Every successful query writes `ADMIN_AUDIT_LOG_READ` (the filter set is captured in metadata) — audit-of-the-audit.
- Admin role is granted out-of-band in V1 (direct DB update + `ADMIN_ROLE_GRANTED` audit row); a self-service grant flow is out of scope until Sprint 10+.

## 7. Field-level encryption (gap G10)

- Per-tenant data encryption keys (DEKs) wrapped by an AWS KMS Customer Master Key, persisted in `psychologist_tenant_keys`.
- Envelope format documented in `@cureocity/crypto`. Implementation in `packages/crypto`: `LocalDevKmsProvider` for dev/CI, `AwsKmsProvider` for production.
- 90-day rotation cadence — old DEKs are not deleted, only marked `retiredAt`, so historical ciphertext remains decryptable until a backfill cron rotates the rows forward. Sprint 10 hardens the rotation cron + plaintext-column drop.
- Encryption is wired into the journal-entry write path today (Sprint 9 PR 3). Sprint 10 extends the same pattern to `Client.contactPhone[Encrypted]`, `Client.contactEmail[Encrypted]`, and `NoteDraft.transcript[Encrypted]`.

## 8. RFI playbook

When a regulator (or a data principal via grievance) sends a Request For Information, the admin runs:

1. **Confirm the principal's identity** via Firebase phone OTP through the `/me/dsr/*` surface, OR via a verified email channel if the principal cannot use the PWA.
2. **Trigger a data export** — `GET /api/v1/me/dsr/data-export` (impersonation requires admin role + an `ADMIN_*` audit row).
3. **Filter audit logs** — `GET /api/v1/admin/audit-logs?targetId={clientId}&action=...` to enumerate every touch.
4. **Document the response** — every interaction is itself audited via `ADMIN_AUDIT_LOG_READ`, providing a closed chain.

## 9. Open items (tracked into Sprint 10)

- Backfill cron to populate encrypted columns for pre-PR-3 rows.
- Plaintext-column drop migration (after backfill complete).
- DEK rotation cron, 90-day cadence.
- Admin UI for the erasure + grievance queues (currently DB-only).
- Formal DPO appointment + their contact published at `/api/v1/dpo-contact`.
