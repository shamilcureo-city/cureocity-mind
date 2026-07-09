-- Sprint 32 Phase 2 — drop the legacy plaintext Client PII columns.
--
-- PII now lives ONLY in the envelope-encrypted twins
-- (fullNameEncrypted / contactPhoneEncrypted / contactEmailEncrypted), wrapped
-- by a per-tenant DEK under Google Cloud KMS (asia-south1). Every read resolves
-- through apps/web/lib/client-pii.ts; every write sets the encrypted columns.
--
-- IRREVERSIBLE: the plaintext values are discarded. Safe here because the read
-- cutover + GCP KMS encryption shipped first and were verified live.
--
-- Idempotent (DROP COLUMN IF EXISTS) so the P3009 self-heal can replay it.
-- The physical table is "clients" (Client model @@map("clients")).
ALTER TABLE "clients" DROP COLUMN IF EXISTS "fullName";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "contactPhone";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "contactEmail";
