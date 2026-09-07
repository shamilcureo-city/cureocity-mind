-- Independent encrypted manual-edit checkpoints. Never changes note_drafts.
CREATE TABLE IF NOT EXISTS "note_edit_recoveries" (
  "sessionId" TEXT NOT NULL,
  "encryptedFields" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "baseDraftUpdatedAt" TIMESTAMP(3),
  "kind" "SessionKind",
  "lastMutationId" UUID,
  "lastMutationRevision" INTEGER,
  "lastMutationOperation" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "note_edit_recoveries_pkey" PRIMARY KEY ("sessionId"),
  CONSTRAINT "note_edit_recoveries_revision_check" CHECK ("revision" >= 0)
);

DO $$ BEGIN
  ALTER TABLE "note_edit_recoveries"
    ADD CONSTRAINT "note_edit_recoveries_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
