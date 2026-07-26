-- Batch E (DPDP) — transcript retention.
--
-- A LIVE consult never writes an AudioChunk: its raw capture exists only as
-- NoteDraft.transcript. The audio-retention purge could therefore never reach
-- it, so live transcripts were retained indefinitely while batch audio aged
-- out at 30 days. Idempotent per the repo convention (CLAUDE.md §4).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TRANSCRIPT_RETENTION_PURGED';
