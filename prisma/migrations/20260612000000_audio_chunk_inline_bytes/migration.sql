-- Sprint 2 fallback: store PCM chunks inline as BYTEA after Vercel
-- Blob client uploads were observed to hang silently in production.
ALTER TABLE "audio_chunks"
  ADD COLUMN "bytes" BYTEA;

-- Make s3Key tolerant of an empty default so new chunks can be inserted
-- without a Blob URL.
ALTER TABLE "audio_chunks"
  ALTER COLUMN "s3Key" SET DEFAULT '';
