-- Sprint 57 — Transcribe-on-arrival.
--
-- Adds the TranscriptSegment table so Pass 1 (audio -> transcript +
-- diarization + affect) runs on each 30s window as it arrives during the
-- session, instead of one giant call against the whole session at "End".
-- The orchestrator (apps/web/lib/note-orchestrator.ts) assembles a finished
-- transcript from these rows when generate-note is invoked; missing rows
-- are backstop-transcribed inline.
--
-- Idempotent: a re-run on a partially-migrated DB is safe.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TranscriptSegmentStatus') THEN
    CREATE TYPE "TranscriptSegmentStatus" AS ENUM ('PENDING', 'TRANSCRIBING', 'COMPLETED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "transcript_segments" (
  "id"                TEXT NOT NULL,
  "sessionId"         TEXT NOT NULL,
  "audioChunkId"      TEXT NOT NULL,
  "chunkIndex"        INTEGER NOT NULL,
  "status"            "TranscriptSegmentStatus" NOT NULL DEFAULT 'PENDING',
  "transcript"        TEXT,
  "speakerSegments"   JSONB,
  "affectFeatures"    JSONB,
  "detectedLanguages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "model"             TEXT,
  "region"            TEXT,
  "costInr"           DECIMAL(10, 4) NOT NULL DEFAULT 0,
  "latencyMs"         INTEGER NOT NULL DEFAULT 0,
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "errorMessage"      TEXT,
  "startedAt"         TIMESTAMP(3),
  "completedAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "transcript_segments_audioChunkId_key"
  ON "transcript_segments" ("audioChunkId");
CREATE UNIQUE INDEX IF NOT EXISTS "transcript_segments_sessionId_chunkIndex_key"
  ON "transcript_segments" ("sessionId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "transcript_segments_sessionId_status_idx"
  ON "transcript_segments" ("sessionId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transcript_segments_sessionId_fkey'
  ) THEN
    ALTER TABLE "transcript_segments"
      ADD CONSTRAINT "transcript_segments_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transcript_segments_audioChunkId_fkey'
  ) THEN
    ALTER TABLE "transcript_segments"
      ADD CONSTRAINT "transcript_segments_audioChunkId_fkey"
      FOREIGN KEY ("audioChunkId") REFERENCES "audio_chunks" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TRANSCRIPT_SEGMENT_TRANSCRIBED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TRANSCRIPT_SEGMENT_FAILED';
