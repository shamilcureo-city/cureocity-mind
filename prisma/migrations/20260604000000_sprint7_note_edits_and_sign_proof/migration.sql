-- Sprint 7 PR 4 — NoteEdit history + WebAuthn sign proof on TherapyNote.
-- Resolves gap G11 (editorial audit trail) and persists the non-repudiation
-- proof captured by therapist-web at sign time so an auditor can re-verify
-- months later without trusting application logs.

-- CreateEnum
CREATE TYPE "NoteEditField" AS ENUM ('subjective', 'objective', 'assessment', 'plan');

-- AlterTable — sign-proof columns on therapy_notes (all nullable so a row
-- written before this migration ran isn't blocked; the application requires
-- them from this PR onward).
ALTER TABLE "therapy_notes"
  ADD COLUMN "signCredentialId" TEXT,
  ADD COLUMN "signClientDataJsonB64u" TEXT,
  ADD COLUMN "signAuthenticatorDataB64u" TEXT,
  ADD COLUMN "signSignatureB64u" TEXT,
  ADD COLUMN "signChallengeHashHex" TEXT;

-- CreateTable
CREATE TABLE "note_edits" (
    "id" TEXT NOT NULL,
    "therapyNoteId" TEXT NOT NULL,
    "field" "NoteEditField" NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_edits_therapyNoteId_createdAt_idx" ON "note_edits"("therapyNoteId", "createdAt");

-- AddForeignKey
ALTER TABLE "note_edits" ADD CONSTRAINT "note_edits_therapyNoteId_fkey" FOREIGN KEY ("therapyNoteId") REFERENCES "therapy_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
