-- Preserve the exact clinical credential that authorized a medical signature.
-- Additive, nullable, and replay-safe for existing therapy and medical notes.
ALTER TABLE "therapy_notes"
  ADD COLUMN IF NOT EXISTS "medicalSigningCredentialId" TEXT,
  ADD COLUMN IF NOT EXISTS "medicalSigningCredentialSnapshot" JSONB;
