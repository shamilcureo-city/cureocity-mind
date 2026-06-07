-- Sprint 20 Phase 3 follow-up — per-goal achievement status.
--
-- Adds a side table for treatment-plan goal progress, keyed by
-- (treatmentPlanId, goalIndex) against the goals array inside
-- TreatmentPlan.body. Kept out of the versioned plan JSON so toggling
-- a goal's status doesn't re-version the plan.

DO $$ BEGIN
    CREATE TYPE "TreatmentGoalStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "treatment_goal_progress" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "goalIndex" INTEGER NOT NULL,
    "status" "TreatmentGoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "updatedByPsychologistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_goal_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "treatment_goal_progress_treatmentPlanId_goalIndex_key"
    ON "treatment_goal_progress" ("treatmentPlanId", "goalIndex");
CREATE INDEX IF NOT EXISTS "treatment_goal_progress_treatmentPlanId_idx"
    ON "treatment_goal_progress" ("treatmentPlanId");

DO $$ BEGIN
    ALTER TABLE "treatment_goal_progress"
        ADD CONSTRAINT "treatment_goal_progress_treatmentPlanId_fkey"
        FOREIGN KEY ("treatmentPlanId") REFERENCES "treatment_plans" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TREATMENT_GOAL_PROGRESS_UPDATED';
