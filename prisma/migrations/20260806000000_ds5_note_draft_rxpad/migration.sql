-- Sprint DS5 — store the signable Rx pad alongside the live consult's note.
-- Guarded / idempotent so a re-run or the P3009 self-heal is safe.
ALTER TABLE "note_drafts" ADD COLUMN IF NOT EXISTS "rxPad" JSONB;
