-- Sprint 32 Phase 1: per-tenant PII encryption rollout audit actions.
--
-- The encrypted columns (Client.contactPhoneEncrypted /
-- contactEmailEncrypted, Session.transcriptEncrypted) and the
-- PsychologistTenantKey table were created earlier (Sprint 9 PR 3,
-- gap G10). What was missing was the audit-action enum entries — the
-- writers in apps/web were a no-op so far.
--
-- ENCRYPTION_KEY_PROVISIONED — fires once per psychologist the first
-- time `encryptForTenant` resolves a DEK and finds no active
-- PsychologistTenantKey row, prompting an auto-provision.
-- ENCRYPTION_BACKFILL_RAN — emitted by POST /api/v1/admin/encryption/
-- backfill summarising how many Client rows were dual-write-completed.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCRYPTION_KEY_PROVISIONED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCRYPTION_BACKFILL_RAN';
