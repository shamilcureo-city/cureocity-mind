-- Sprint 66 — therapist-authored letters (referral / supporting).

CREATE TYPE "LetterKind" AS ENUM ('REFERRAL', 'ATTENDANCE', 'FITNESS', 'SUPPORT');

CREATE TABLE "letters" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "kind" "LetterKind" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "letters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "letters_clientId_createdAt_idx" ON "letters"("clientId", "createdAt");
CREATE INDEX "letters_psychologistId_createdAt_idx" ON "letters"("psychologistId", "createdAt");

-- New audit action for "a therapist generated a letter".
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LETTER_GENERATED';
