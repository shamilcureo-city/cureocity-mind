-- Sprint 3b PR-2: PATCH /workflows/[id]/goals/[goalId] writes a new
-- AuditAction value when a therapist marks a goal achieved/unachieved.
ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_GOAL_UPDATED';
