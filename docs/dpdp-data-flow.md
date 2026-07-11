# DPDP Data Flow — Cureocity Mind

Status: published Sprint 9; **rewritten July 2026 (AUD3)** to match the
deployed system — the original described a planned microservice + S3
topology that was never the production path. Owner: data-protection
officer (DPO) once appointed; until then, this document is the
authoritative reference clinicians and admins use to answer regulator
RFIs under the Digital Personal Data Protection Act, 2023 (India).

**Deployed reality in one paragraph:** every HTTP endpoint is a Next.js
route in `apps/web` on Vercel; the database is Neon Postgres; session
audio is stored INLINE in Postgres (`audio_chunks.bytes`, BYTEA) — there
is no S3 audio bucket; the only other runtime is the doctor live-scribe
WebSocket gateway on Cloud Run (asia-south1), which holds NO database
and persists nothing itself. The NestJS `services/*` apps named in older
revisions of this document (scribe-service, patient-model-service,
continuity-service, pdf-generator-service) are test scaffolds with no
production traffic.

## 1. Roles under the DPDP Act

| DPDP role       | Cureocity Mind party                   | Notes                                                                                                                             |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Data Principal  | Client (patient)                       | Owns the right to access/correct/erase.                                                                                           |
| Data Fiduciary  | Cureocity Mind (the platform operator) | Determines purpose + means of processing.                                                                                         |
| Data Processor  | Google Vertex AI (Gemini Flash, Pro)   | Processes audio (Pass 1, asia-south1) + de-identified transcript (later passes) on behalf of the Fiduciary. Bound by GCP DPA.     |
| Data Processor  | Neon (Postgres)                        | Primary datastore — ALL personal data incl. inline session audio. Region pinned at project creation (verify in the Neon console). |
| Data Processor  | Vercel                                 | Hosts `apps/web` (all HTTP), runs the retention cron, terminates TLS.                                                             |
| Data Processor  | Google Cloud KMS (asia-south1)         | Wraps the per-tenant data-encryption keys (§ 7). Key material never leaves KMS.                                                   |
| Data Processor  | Google Cloud Run (asia-south1)         | The doctor live-scribe gateway. Stateless; audio transits in memory only; no persistence.                                         |
| Data Processor  | WATI (WhatsApp Business)               | Delivers share notifications. India-resident.                                                                                     |
| Data Processor  | Twilio, SendGrid                       | Outbound SMS + email fallbacks. Bound by their DPAs.                                                                              |
| Consent Manager | Not used in V1                         | When a regulator-authorised Consent Manager registry is operational, the `consents` table is the migration target.                |

## 2. Personal data categories + retention windows

| Category           | Examples                                 | Where it lives                                                                 | Encryption                                      | Retention                                                                                            |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Identity           | client name                              | `clients.fullNameEncrypted`                                                    | AES-256-GCM, per-tenant DEK (plaintext DROPPED) | Active + 7y post-discharge (RCI clinical record requirement).                                        |
| Practitioner       | therapist/doctor name, RCI number        | `psychologists`                                                                | Plaintext (professional, not patient, data)     | Account lifetime + 7y.                                                                               |
| Contact PII        | phone, email                             | `clients.contactPhoneEncrypted`, `contactEmailEncrypted`                       | AES-256-GCM, per-tenant DEK (plaintext DROPPED) | Same as Identity.                                                                                    |
| Session audio      | 16 kHz PCM chunks                        | `audio_chunks.bytes` (Postgres BYTEA, inline)                                  | Postgres storage encryption (Neon at-rest AES)  | **30 days hard delete** via daily Vercel cron `/api/v1/cron/audio-retention` (03:00 UTC) — see § 4a. |
| Transcript         | text Pass-1 output                       | `note_drafts.transcript[Encrypted]`                                            | AES-256-GCM, per-tenant DEK (dual-write)        | Joined to TherapyNote retention (active + 7y).                                                       |
| Therapy note       | signed SOAP + risk flags                 | `therapy_notes`                                                                | JSON column; PII low after de-id                | Active + 7y. Immutable post-sign (revisions via `note_edits`).                                       |
| NoteEdit history   | before/after of every signed-note edit   | `note_edits`                                                                   | Plaintext (audit trail integrity)               | Same as therapy_notes.                                                                               |
| Journal entries    | client-private reflections               | `journal_entries` (`contentEncrypted` column exists; no live write path in V1) | —                                               | Client-controlled — erasure on DSR request fulfils within 30 days.                                   |
| Mood logs          | 0..10 rating + optional note             | `mood_logs`                                                                    | Plaintext (low sensitivity)                     | Same as Journal.                                                                                     |
| Exercise responses | structured + free text                   | `exercise_assignments.response`                                                | JSON column                                     | Same as Journal.                                                                                     |
| Audit log          | every state-changing action              | `audit_logs`                                                                   | Plaintext (integrity > confidentiality)         | Active + 10y (regulator + grievance window).                                                         |
| Consent records    | scope, script-version, granted/withdrawn | `consents` (+ per-session snapshot in `sessions.consentSnapshot`)              | Plaintext                                       | Active + 10y (proof of lawful basis).                                                                |
| Push subscriptions | Web Push endpoint + keys                 | `client_push_subscriptions`                                                    | Plaintext (revocable)                           | Until revokedAt + 90d, then hard delete.                                                             |
| DSR rows           | nominations, erasures, grievances        | `client_nominations`, `client_erasure_requests`, `client_grievances`           | Plaintext (legal evidence)                      | Active + 10y.                                                                                        |
| Clinical brief     | Pass 3 output + per-section confirmation | `clinical_reports`                                                             | JSON column (transcript quotes inside)          | Same as therapy_notes (active + 7y).                                                                 |
| Client diagnoses   | cumulative confirmed ICD-11 entries      | `client_diagnoses`                                                             | JSON supporting quotes                          | Active + 7y. Supersedable, never deleted.                                                            |
| Treatment plans    | versioned confirmed plans                | `treatment_plans`                                                              | JSON                                            | Active + 7y. Supersedable.                                                                           |
| Therapy scripts    | Pass 4 cached output                     | `therapy_scripts`                                                              | JSON                                            | Cache; can be safely deleted on regenerate.                                                          |
| Patient shares     | snapshot at share time + delivery state  | `patient_shares`                                                               | JSON snapshot                                   | Default 30d portal expiry; row retained for audit (active + 10y).                                    |
| Pre-session briefs | Pass 5 cached output                     | `pre_session_briefs`                                                           | JSON                                            | Cache; regenerates per new session.                                                                  |
| Instrument scores  | PHQ-9 / GAD-7 administrations            | `instrument_responses`                                                         | JSON answer map                                 | Active + 7y (clinical record).                                                                       |
| Safety plans       | Stanley & Brown 5-step crisis plans      | `safety_plans`                                                                 | JSON                                            | Active + 7y. Supersedable.                                                                           |
| Rx pads / orders   | doctor prescriptions + clinical orders   | `note_drafts.rxPad`, `medication_orders`, `clinical_orders`                    | JSON                                            | Active + 7y (medical record).                                                                        |
| Live consult meter | per-consult token/cost/latency counters  | `live_consult_metrics`                                                         | Plaintext (no clinical content)                 | Operational — 2y.                                                                                    |

## 3. Data flow (deployed topology)

```
Therapist / Doctor (browser)                 Client (patient browser)
+--------------------------+                 +----------------------+
| Firebase sign-in          |                 | /p/<token> portal    |
| __session cookie / Bearer |                 | (no login; scoped    |
+------------+-------------+                 |  share token)        |
             |                               +----------+-----------+
             v                                          |
   +-------------------------------- Vercel ------------v----------+
   | apps/web (Next.js) — the ONLY HTTP surface                    |
   |   /api/v1/sessions/*   record, notes, sign, share             |
   |   /api/v1/audio/chunks/upload  --> audio_chunks.bytes (BYTEA) |
   |   /api/v1/clients/[id]/dsr/*   DSR endpoints (§ 5)            |
   |   /api/v1/cron/audio-retention daily purge (§ 4a)             |
   +----+----------------------+----------------------+------------+
        |                      |                      |
        v                      v                      v
   Neon Postgres          Vertex Gemini          WATI / SendGrid /
   (ALL personal data,    Pass 1 Flash           Twilio (share
   incl. inline audio;    asia-south1 (audio);   notifications only —
   per-tenant field       Pass 2-5 Pro global    first name + portal
   encryption via         (de-identified         link, no clinical
   Google Cloud KMS)      transcript only)       content in-channel)

Doctor LIVE consult only:
   browser mic --PCM over WSS--> live-gateway (Cloud Run, asia-south1)
   - stateless: audio + transcript held in memory for the consult only
   - NO database; the browser relays results to /api/v1/sessions/[id]/live-*
   - Vertex calls from the gateway stay in asia-south1 (Flash) / global (Pro)
```

## 4. Cross-border processing (DPDP § 16)

- **Audio never reaches an object store or third country by design.**
  Batch audio is written inline to Postgres (`audio_chunks.bytes`) and
  sent once to Vertex Gemini Flash in **asia-south1** for Pass 1
  transcription. Live-consult audio transits the Cloud Run gateway in
  **asia-south1** in memory only. (Legacy `s3Key` fallback exists in the
  schema for pre-Sprint-2 rows; no production rows use it.)
- **Neon region**: the Postgres project region is fixed at creation —
  the DPO record must state it. Operational item: confirm the project
  region in the Neon console and record it here.
- **Pass 2–5 (notes, clinical analysis, scripts, briefs)**: Gemini Pro,
  currently the **global** endpoint. Input is de-identified text only —
  no audio, no identifiers. The `CROSS_BORDER_PROCESSING` consent scope
  is mandatory before any session is processed; the session-start
  consent snapshot proves it per session.
- **WATI**: Mumbai-resident. WhatsApp messages carry only the client's
  first name + a portal link; clinical content stays behind `/p/<token>`
  served from Vercel.

When the Central Government issues a § 16(1) jurisdiction list
restricting outflow, the only adjustment needed is to swap Pass 2–5 to a
regional Pro endpoint: each pass is a distinct `ModelRouter` backend, so
the swap is per-pass env configuration (`VERTEX_*_MODEL`), no
architecture change.

### 4a. Audio retention — how deletion actually happens

- Store: `audio_chunks` rows in Postgres, PCM bytes inline (BYTEA).
- Purge: `GET /api/v1/cron/audio-retention`, scheduled daily at 03:00
  UTC by `apps/web/vercel.json`. Auth **fails closed**: `CRON_SECRET`
  must be configured and presented as a Bearer token — an unset secret
  refuses every invocation (and pages ops via the error log).
- Window: `AUDIO_RETENTION_DAYS` (default **30**). Eligible sessions:
  - `COMPLETED` with `endedAt` older than the window, **and**
  - any session that never completed (abandoned recording, cancelled,
    no-show) whose `createdAt` is older than the window — audio must
    not outlive the window just because the session was never finished.
- Exemption: clients holding a GRANTED, un-withdrawn
  `DATA_RETENTION_EXTENDED` consent are skipped.
- Proof: one `AUDIO_RETENTION_PURGED` audit row per purged session
  (chunk count, bytes, session status, timestamps, window) — the
  regulator-facing evidence that the purge ran on schedule.
- Deletion is a hard `DELETE` of the BYTEA rows; Postgres storage is
  reclaimed by Neon's autovacuum. Neon point-in-time-restore branches
  age out on the project's history-retention setting — keep it ≤ the
  audio window + 7 days so deleted audio also leaves backups.

## 5. Data subject rights (DPDP §§ 11–15)

V1 is **therapist-mediated**: the data principal exercises rights
through their practitioner (or the grievance email), and the therapist
operates these endpoints from the client's profile. There is no
patient-authenticated self-serve DSR surface yet (the portal is
share-scoped, not account-scoped).

| Right                 | Endpoint                                            | Audit action(s)                                                                    | SLA         |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- |
| § 11 Access           | `GET   /api/v1/clients/[id]/dsr/data-export`        | `DSR_ACCESS_FULFILLED`                                                             | 30 days max |
| § 12 Correction       | `PATCH /api/v1/clients/[id]/dsr/correction`         | `DSR_CORRECTION_REQUESTED`                                                         | 30 days max |
| § 13 Nomination       | `POST  /api/v1/clients/[id]/dsr/nomination`         | `DSR_NOMINATION_RECORDED`                                                          | Immediate   |
| § 13 Withdraw consent | `POST  /api/v1/clients/[id]/dsr/consent-withdrawal` | `DSR_CONSENT_WITHDRAWN`                                                            | Immediate   |
| § 14 Grievance        | `POST  /api/v1/clients/[id]/dsr/grievance`          | `DSR_GRIEVANCE_FILED`                                                              | 7 days ack  |
| § 15 Erasure          | `POST  /api/v1/clients/[id]/dsr/erasure`            | `DSR_ERASURE_REQUESTED` → `DSR_ERASURE_FULFILLED` (fulfilment via the admin queue) | 30 days max |

The admin erasure queue (`/api/v1/admin/erasure/[id]`) resolves open
erasure requests; status transitions are recorded on the request row
plus `audit_logs`. Note the clinical-record carve-out: signed notes,
diagnoses, and plans within the RCI 7-year retention window are
retained under DPDP § 8(7) (legal obligation) even when other data is
erased — the erasure fulfilment metadata records what was withheld and
why.

## 6. Audit log + admin review

- Every state-changing endpoint writes one `audit_logs` row via
  `writeAudit` (`apps/web/lib/audit.ts`). The list of audit actions is
  enumerated in `packages/contracts/src/audit.ts` (`AuditActionSchema`).
- **Audit coverage test**: `packages/contracts/src/audit-coverage.spec.ts`
  scans `apps/web/{app/api,lib,app/p}` and asserts each `AuditAction`
  enum value has at least one writer site. Failing this test means a
  regulator could ask "where is action X audited?" and the codebase has
  no answer.
- **Admin audit-log read**: `GET /api/v1/admin/audit-logs` returns a
  filtered + cursor-paginated slice. Every successful query writes
  `ADMIN_AUDIT_LOG_READ` (the filter set is captured in metadata) —
  audit-of-the-audit.
- Admin role is granted out-of-band in V1 (direct DB update +
  `ADMIN_ROLE_GRANTED` audit row).

## 7. Field-level encryption

- Per-tenant data encryption keys (DEKs) wrapped by a **Google Cloud
  KMS** key in asia-south1, persisted in `psychologist_tenant_keys`.
  Production uses `GcpKmsProvider` (REST API, reusing the Vertex
  service-account credential); dev/CI uses `LocalDevKmsProvider`.
  (`AwsKmsProvider` exists in `packages/crypto` for portability but is
  not wired.)
- Envelope format documented in `@cureocity/crypto` (AES-256-GCM data
  encryption, KMS-wrapped DEK).
- Encrypted fields: `clients.fullNameEncrypted`, `contactPhoneEncrypted`,
  `contactEmailEncrypted` (the plaintext columns were **dropped** —
  S32 Phase 2), and `note_drafts.transcriptEncrypted` (dual-write).
- Read path is decrypt-only: `apps/web/lib/client-pii.ts` decrypts the
  `*Encrypted` columns with no plaintext fallback; an undecryptable
  value renders empty and is logged (recover via
  `/admin/encryption/backfill`).
- 90-day rotation cadence — old DEKs are not deleted, only marked
  `retiredAt`, so historical ciphertext remains decryptable until a
  backfill rotates the rows forward.

## 8. RFI playbook

When a regulator (or a data principal via grievance) sends a Request
For Information, the admin runs:

1. **Confirm the principal's identity** via their practitioner (V1 is
   therapist-mediated) or a verified email channel.
2. **Trigger a data export** — `GET /api/v1/clients/[id]/dsr/data-export`
   (writes `DSR_ACCESS_REQUESTED` / `DSR_ACCESS_FULFILLED`).
3. **Filter audit logs** — `GET /api/v1/admin/audit-logs?targetId={clientId}`
   to enumerate every touch.
4. **Prove retention compliance** — filter `AUDIO_RETENTION_PURGED`
   audit rows for the client's sessions.
5. **Document the response** — every interaction is itself audited via
   `ADMIN_AUDIT_LOG_READ`, providing a closed chain.

## 9. Open items

- Record the Neon project region in § 4 (ops: read it off the console).
- Journal-entry encryption write path (`contentEncrypted` column exists;
  journal creation is a future patient-app concern).
- Patient-authenticated self-serve DSR surface (V1 is
  therapist-mediated).
- Formal DPO appointment + published contact.
- Consent Manager integration once the registry is operational.
