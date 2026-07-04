-- Sprint 73 — session ↔ problem-list-item tagging.
--
-- A join table recording which problems a session worked on, so the
-- therapist can thread a single problem across the whole case (which
-- sessions advanced it) and see, on any note, what was addressed that
-- session. Plus the SESSION_PROBLEMS_TAGGED audit action.
--
-- Guarded / idempotent per CLAUDE.md §4 (safe to replay under the P3009
-- self-heal).

-- CreateTable
CREATE TABLE IF NOT EXISTS "session_problem_links" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "problemListItemId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_problem_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "session_problem_links_sessionId_problemListItemId_key" ON "session_problem_links"("sessionId", "problemListItemId");
CREATE INDEX IF NOT EXISTS "session_problem_links_problemListItemId_idx" ON "session_problem_links"("problemListItemId");
CREATE INDEX IF NOT EXISTS "session_problem_links_sessionId_idx" ON "session_problem_links"("sessionId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "session_problem_links" ADD CONSTRAINT "session_problem_links_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "session_problem_links" ADD CONSTRAINT "session_problem_links_problemListItemId_fkey"
    FOREIGN KEY ("problemListItemId") REFERENCES "problem_list_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterEnum — session↔problem tag audit action (append-only, idempotent).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_PROBLEMS_TAGGED';
