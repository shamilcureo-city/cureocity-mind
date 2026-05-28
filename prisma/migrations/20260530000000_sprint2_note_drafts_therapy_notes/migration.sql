-- CreateEnum
CREATE TYPE "NoteDraftStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NoteRiskSeverity" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "note_drafts" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "NoteDraftStatus" NOT NULL DEFAULT 'PENDING',
    "transcript" TEXT,
    "speakerSegments" JSONB,
    "affectFeatures" JSONB,
    "content" JSONB,
    "riskSeverity" "NoteRiskSeverity",
    "totalCostInr" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_notes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "signedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "note_drafts_sessionId_key" ON "note_drafts"("sessionId");

-- CreateIndex
CREATE INDEX "note_drafts_status_createdAt_idx" ON "note_drafts"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_notes_sessionId_key" ON "therapy_notes"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_notes_draftId_key" ON "therapy_notes"("draftId");

-- AddForeignKey
ALTER TABLE "note_drafts" ADD CONSTRAINT "note_drafts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_notes" ADD CONSTRAINT "therapy_notes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_notes" ADD CONSTRAINT "therapy_notes_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "note_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

