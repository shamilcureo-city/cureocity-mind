-- Sprint 8 PR 2 — journal share/private toggle.
-- Default false (private) so existing rows aren't unexpectedly visible to
-- the therapist briefing after the migration runs.

ALTER TABLE "journal_entries"
  ADD COLUMN "sharedWithTherapist" BOOLEAN NOT NULL DEFAULT false;
