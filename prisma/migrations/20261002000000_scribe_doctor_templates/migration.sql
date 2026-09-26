-- Doctor-owned reusable preferences, never patient/session data. Apply separately from web release.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "scribe_workspace_records" DROP CONSTRAINT IF EXISTS "scribe_workspace_kind";
ALTER TABLE "scribe_workspace_records" ADD CONSTRAINT "scribe_workspace_kind"
  CHECK ("kind" IN ('shortcut', 'note_style', 'template', 'intake', 'task', 'report', 'instructions', 'teleconsult', 'coding', 'documents'));
ALTER TABLE "scribe_workspace_records" DROP CONSTRAINT IF EXISTS "scribe_workspace_scope";
ALTER TABLE "scribe_workspace_records" ADD CONSTRAINT "scribe_workspace_scope" CHECK (
  ("kind" IN ('shortcut', 'note_style', 'template') AND "clientId" IS NULL AND "sessionId" IS NULL)
  OR ("kind" IN ('intake', 'task', 'report', 'instructions') AND "clientId" IS NOT NULL)
  OR ("kind" IN ('teleconsult', 'coding', 'documents') AND "clientId" IS NOT NULL AND "sessionId" IS NOT NULL)
);
COMMIT;
