-- Sprint 70 — per-session note template selection (the "BASE" picker).
-- A scalar FK to a NoteTemplate; null = the built-in SOAP structure. Pass 2
-- reads it to also produce template-shaped sections alongside SOAP.
-- Guarded / idempotent so a re-run or the P3009 self-heal is safe.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "noteTemplateId" TEXT;
