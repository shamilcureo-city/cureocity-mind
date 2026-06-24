-- Sprint 67c — per-client maintained problem list.

CREATE TYPE "ProblemStatus" AS ENUM ('ACTIVE', 'RESOLVED');

CREATE TABLE "problem_list_items" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" "ProblemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "problem_list_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "problem_list_items_clientId_status_idx" ON "problem_list_items"("clientId", "status");

-- New audit actions for the problem-list lifecycle.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROBLEM_LIST_ITEM_ADDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROBLEM_LIST_ITEM_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROBLEM_LIST_ITEM_REMOVED';
