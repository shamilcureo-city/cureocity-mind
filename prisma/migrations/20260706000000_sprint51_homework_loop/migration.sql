-- Sprint 51 — homework loop.
--
-- Until now, the therapy script's `homework` field was stale text in
-- the share snapshot — there was no row anyone could mark COMPLETED,
-- so the pre-session brief's `homeworkStatus` was always LLM
-- guesswork. We already have an `ExerciseAssignment` model with the
-- right lifecycle (PENDING / IN_PROGRESS / COMPLETED / SKIPPED /
-- EXPIRED) — it just wasn't reachable from the share path because:
--   1. `exerciseId` is NOT NULL + regex-validated to a catalog id,
--      so free-text script homework can't be stored.
--   2. There's no link back to the source script so subsequent shares
--      can dedupe.
--   3. There's no marker for "where did this come from".
--
-- This migration extends the existing model rather than adding a new
-- table:
--   1. `source` enum (CATALOG | THERAPY_SCRIPT) with default CATALOG
--      so every legacy row keeps its meaning without a backfill.
--   2. `customDescription` free-text column for script-sourced rows.
--   3. `sourceTherapyScriptId` FK-by-string for dedupe + provenance.
--   4. `exerciseId` becomes NULLABLE because script-sourced rows
--      legitimately have no catalog id.

-- 1. New enum. Creating + using in the same migration is safe (only
--    ALTER TYPE ... ADD VALUE has the same-transaction-use restriction).
DO $$ BEGIN
  CREATE TYPE "ExerciseAssignmentSource" AS ENUM ('CATALOG', 'THERAPY_SCRIPT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2/3. Add the new columns. NOT NULL with default keeps the migration
--      non-destructive — every existing row gets CATALOG without a
--      backfill.
ALTER TABLE "exercise_assignments"
  ADD COLUMN IF NOT EXISTS "source" "ExerciseAssignmentSource" NOT NULL DEFAULT 'CATALOG',
  ADD COLUMN IF NOT EXISTS "customDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceTherapyScriptId" TEXT;

-- 4. Relax exerciseId. Existing rows keep their catalog id; new
--    script-sourced rows can leave it NULL.
ALTER TABLE "exercise_assignments" ALTER COLUMN "exerciseId" DROP NOT NULL;
