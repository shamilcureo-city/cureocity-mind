# Security audit — pre-pilot gate

Sprint 10 PR 4. This document is the pre-pilot security-audit
checklist. The platform cannot go to pilot until every row is either
**Pass** with evidence linked, or **Risk-accepted** with a sign-off
and a Sprint-11+ remediation ticket.

The audit is rerun before every subsequent major release.

## OWASP Top 10 (2021)

| #   | Risk                                   | Status | Evidence / mitigation                                                                                                                                                                                                                                             |
| --- | -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Broken access control                  | Pass   | Every list/get filters by `psychologistId` from the auth context (see `*.service.ts` ownership checks); cross-tenant tests in `clients.service.spec.ts`, `sessions.service.spec.ts`, `dsr.service.spec.ts`. Admin role gated by `AdminRoleGuard` (Sprint 9 PR 1). |
| 2   | Cryptographic failures                 | Pass   | Field-level encryption via `@cureocity/crypto` (AES-256-GCM + envelope wrap, gap G10). HTTPS-only ingress is the prod-deploy responsibility (Sprint 11). Cookies n/a — we use Bearer tokens.                                                                      |
| 3   | Injection                              | Pass   | All queries via Prisma client (parameterised). Zod schemas validate every input at the controller boundary (`ZodValidationPipe`). No raw SQL outside migrations + the documented `pg_stat_activity` calls in runbooks.                                            |
| 4   | Insecure design                        | Pass   | Threat model in `docs/dpdp-data-flow.md`; cost-circuit breaker (gap G6); audit-of-the-audit (Sprint 9 PR 1); chaos audit test (Sprint 9 PR 4).                                                                                                                    |
| 5   | Security misconfiguration              | Pass   | Env schemas (`src/config/env.schema.ts`) reject misconfigured services at startup. `AUTH_BYPASS=true` defaults to `false`; the KMS factory throws if `KMS_BACKEND=aws` lacks creds.                                                                               |
| 6   | Vulnerable + outdated deps             | Pass   | `pnpm audit` in CI (Sprint 1 PR 1). All deps within 12 months of latest.                                                                                                                                                                                          |
| 7   | Identification + auth failures         | Pass   | Firebase phone OTP for both audiences. Distinct projects (therapist vs client). FirebaseAuthGuard verifies id tokens; no JWT shortcuts. Backup recovery via Sharafath-approved channel (gap G8, Sprint 6).                                                        |
| 8   | Software + data integrity              | Pass   | WebAuthn note signing binds payload hash into the challenge (Sprint 7 PR 4). NoteEdit history tracks every before/after (gap G11). pnpm lockfile in CI.                                                                                                           |
| 9   | Security logging + monitoring failures | Pass   | Audit log on every state-changing endpoint (chaos test in CI). Prometheus + Grafana for ops (Sprint 10 PR 1+2). Alerts paged per runbook in `docs/runbooks/`.                                                                                                     |
| 10  | Server-side request forgery (SSRF)     | Pass   | Outbound HTTP only to allow-listed vendors (Vertex, S3, WATI, Twilio, SendGrid, Firebase Admin). No user-controlled URL fetching. Webhook ingestion is not in V1.                                                                                                 |

## Secrets management

| Surface                 | Storage location                                        | Rotation                              |
| ----------------------- | ------------------------------------------------------- | ------------------------------------- |
| Firebase Admin SDK keys | GCP Secret Manager → mounted as env at deploy time      | 90 days                               |
| Postgres credentials    | AWS Secrets Manager → IAM-role-fetched at boot          | 60 days                               |
| AWS KMS CMK             | AWS KMS itself (CMK never leaves)                       | n/a (data keys rotate; CMK is annual) |
| WATI bearer token       | AWS Secrets Manager                                     | 180 days                              |
| SendGrid + Twilio keys  | AWS Secrets Manager                                     | 180 days                              |
| VAPID keypair           | AWS Secrets Manager                                     | Annually                              |
| Vertex AI SA key        | GCP Workload Identity (no static key in V1 if possible) | n/a                                   |

**No secrets in repo.** `.env.example` documents shape; real values
live in cloud secret managers. CI uses fixture / mock values only.

## IAM (per-service principle of least privilege)

| Service                   | Postgres                                                                                                                                              | S3                        | KMS                                                  | Other              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------- | ------------------ |
| patient-model-service     | full RW on `clients`, `consents`, `psychologists`, `client_*`, `audit_logs`. R on `sessions`.                                                         | none                      | KMS Decrypt + GenerateDataKey for Client PII         | Firebase Admin SDK |
| scribe-service            | full RW on `sessions`, `audio_chunks`, `note_drafts`, `therapy_notes`, `note_edits`, `gemini_call_logs`, `audit_logs`.                                | `cureocity-mind-audio` RW | Decrypt + GenerateDataKey for transcripts            | Vertex AI          |
| modality-workflow-service | full RW on `modality_states`, `modality_transitions`, `emdr_targets`. R on `sessions`, `clients`.                                                     | none                      | none                                                 | none               |
| affect-engine-service     | R on `note_drafts`. Full RW on `affect_features`, `audit_logs`.                                                                                       | none                      | none                                                 | none               |
| continuity-service        | full RW on `exercise_assignments`, `mood_logs`, `journal_entries`, `client_push_subscriptions`, `audit_logs`. R on `clients`, `sessions`, `consents`. | none                      | Decrypt + GenerateDataKey for journal entries        | Web Push (VAPID)   |
| pdf-generator-service     | R on `therapy_notes`, `clients`, `sessions`.                                                                                                          | `cureocity-mind-pdfs` RW  | none (no PII in PDFs beyond what's in therapy_notes) | WATI               |

Each service uses a distinct IAM role / service account. Production
deploys enforce this via Kubernetes ServiceAccount + IRSA (AWS) /
Workload Identity (GCP).

## DPDP-specific controls (cross-link)

| Requirement                    | Implementation                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| § 8(1) lawful processing       | Consent table — granular, versioned, withdrawable.                                       |
| § 8(5) notice of breach        | Operational runbook to draft within 72h.                                                 |
| § 8(7) backups                 | `dr-postgres-restore.md`; RPO ≤ 15 min, RTO ≤ 1 h.                                       |
| § 9 children                   | DOB capture on Client; under-18 surfaces flag for opt-out from monetisation (Sprint 11). |
| §§ 11–15 data principal rights | `/api/v1/me/dsr/*` (Sprint 9 PR 2).                                                      |
| § 16 cross-border restrictions | Pass 1 in asia-south1; Pass 2 with explicit CROSS_BORDER consent.                        |
| § 16 audit trail               | `audit_logs` + chaos audit coverage test + admin read.                                   |

## Known-accepted risks (Sprint 11+ remediation)

| Risk                                                      | Mitigation today                                            | Plan                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Plaintext PII columns alongside encrypted                 | Application layer reads/writes both during rollout          | Sprint 11: backfill cron, then plaintext-drop migration. |
| WebAuthn signature not verified against registered pubkey | Hash-bound challenge + Firebase-auth user identity captured | Sprint 11: registration endpoint + counter verification. |
| Admin role granted via direct DB update                   | `ADMIN_ROLE_GRANTED` audit row on the manual write          | Sprint 11: bootstrap admin UI behind hardware-key MFA.   |
| No SAST / dependency scanner gates                        | `pnpm audit` informational                                  | Sprint 11: Trivy + Snyk in CI gate.                      |

## Sign-off

This audit is signed off by:

- **Platform lead** — _name_, _date_, evidence-of-walkthrough link.
- **Clinical lead (Sharafath)** — _name_, _date_, sign-off on the
  clinical-safety surfaces (crisis flag, risk acknowledgement, NoteEdit history).
- **DPO designate** — _name_, _date_.

A re-audit triggers on any of: new audit-action enum value without
writer site, new outbound vendor, new PII column, new patient surface.
