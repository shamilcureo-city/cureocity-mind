-- S-hardening (2026-08): drop the plaintext transcript column.
--
-- Gate cleared before this shipped: the admin backfill's VERIFIED scrub
-- (re-keys stale local-dev ciphertext, round-trips every row through the live
-- KMS before nulling) reported plaintextRemaining = 0 on production. From here
-- the verbatim session transcript exists ONLY envelope-encrypted in
-- "transcriptEncrypted"; the read path is lib/note-transcript.ts.
--
-- Guarded so the P3009 self-heal can replay it.
ALTER TABLE "note_drafts" DROP COLUMN IF EXISTS "transcript";
