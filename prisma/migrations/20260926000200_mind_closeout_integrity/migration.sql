ALTER TABLE "clinical_reports" ADD COLUMN IF NOT EXISTS "planSuggestionState" JSONB;
ALTER TABLE "mind_session_closeout_states" ADD COLUMN IF NOT EXISTS "nextQuestionsSnapshot" JSONB;

-- Preserve currently selected questions as historical session decisions. No
-- completion is invented for earlier questions that were already removed.
INSERT INTO "mind_session_closeout_states" ("sessionId", "nextQuestionsSnapshot", "createdAt", "updatedAt")
SELECT s."id", jsonb_agg(q.value), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "clients" c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c."carriedQuestions") = 'array' THEN c."carriedQuestions" ELSE '[]'::jsonb END
) q(value)
JOIN "sessions" s ON s."id" = q.value->>'sourceSessionId'
  AND s."clientId" = c."id" AND s."psychologistId" = c."psychologistId"
WHERE c."deletedAt" IS NULL
GROUP BY s."id"
ON CONFLICT ("sessionId") DO UPDATE
SET "nextQuestionsSnapshot" = EXCLUDED."nextQuestionsSnapshot"
WHERE "mind_session_closeout_states"."nextQuestionsSnapshot" IS NULL;
