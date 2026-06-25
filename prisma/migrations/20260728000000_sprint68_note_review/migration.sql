-- Sprint 68 — supervision review record on a signed note.

CREATE TABLE "note_reviews" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "therapyNoteId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "note_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "note_reviews_sessionId_idx" ON "note_reviews"("sessionId");
CREATE INDEX "note_reviews_psychologistId_createdAt_idx" ON "note_reviews"("psychologistId", "createdAt");

-- New audit action.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTE_REVIEW_RECORDED';
