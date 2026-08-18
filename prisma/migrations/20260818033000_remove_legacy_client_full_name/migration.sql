-- Forward-only reconciliation for the Codex preview migration.
--
-- Preview deployments briefly restored clients.fullName after the encrypted
-- PII cutover. Current application code reads names exclusively through the
-- encrypted fields, and production may never have received that migration.
-- DROP COLUMN IF EXISTS is safe in both states and removes the plaintext copy
-- wherever the preview migration created it.
ALTER TABLE "clients" DROP COLUMN IF EXISTS "fullName";
