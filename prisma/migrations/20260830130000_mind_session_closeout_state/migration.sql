ALTER TYPE "AuditAction" ADD VALUE 'MIND_CLOSEOUT_DECISION_RECORDED';

CREATE TABLE "mind_session_closeout_states" (
  "sessionId" TEXT NOT NULL,
  "clinicalSuggestionsResolvedAt" TIMESTAMP(3),
  "clinicalSuggestionsSkippedAt" TIMESTAMP(3),
  "agreementsSkippedAt" TIMESTAMP(3),
  "nextQuestionsSkippedAt" TIMESTAMP(3),
  "shareSkippedAt" TIMESTAMP(3),
  "followUpSkippedAt" TIMESTAMP(3),
  "followUpSessionId" TEXT,
  "legacyImported" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mind_session_closeout_states_pkey" PRIMARY KEY ("sessionId")
);

CREATE UNIQUE INDEX "mind_session_closeout_states_followUpSessionId_key"
  ON "mind_session_closeout_states"("followUpSessionId");

ALTER TABLE "mind_session_closeout_states"
  ADD CONSTRAINT "mind_session_closeout_states_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mind_session_closeout_states"
  ADD CONSTRAINT "mind_session_closeout_states_followUpSessionId_fkey"
  FOREIGN KEY ("followUpSessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing signed Mind sessions predate this checklist. Mark them explicitly so
-- legacy mapping never gets inferred merely from the presence of a signed note.
INSERT INTO "mind_session_closeout_states" ("sessionId", "legacyImported", "updatedAt")
SELECT s."id", true, CURRENT_TIMESTAMP
FROM "sessions" s
JOIN "psychologists" p ON p."id" = s."psychologistId"
JOIN "therapy_notes" n ON n."sessionId" = s."id"
WHERE p."vertical" = 'THERAPIST'
ON CONFLICT ("sessionId") DO NOTHING;
