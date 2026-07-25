-- PC3 — direct edits to a confirmed diagnosis.
--
-- The Plan of care can now correct a confirmed diagnosis in place (code,
-- label, primary flag, note) and retire one that no longer holds. Retiring
-- is a supersede, not a delete, so the history stays intact.
--
-- Idempotent per CLAUDE.md § 4 — the P3009 self-heal in
-- scripts/vercel-db-setup.sh replays a failed migration's SQL.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLIENT_DIAGNOSIS_EDITED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLIENT_DIAGNOSIS_RETIRED';
