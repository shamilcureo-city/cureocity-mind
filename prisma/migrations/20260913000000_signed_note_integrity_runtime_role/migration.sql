-- Harden the current signed body and separate append-only history privileges.
-- This is a new migration rather than a checksum-changing edit to the already
-- committed note_signature_versions migration.

-- A trigger alone does not protect this table from its owner. PUBLIC and the
-- separately configured runtime role receive no destructive privileges; the
-- migration owner remains owner so only the privileged deployment path can
-- change policy. scripts/configure-runtime-db-role.mjs applies the named role.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "note_signature_versions" FROM PUBLIC;

-- TherapyNote.content is the current signed body. Only canonical signing and
-- audited DPDP erasure may replace it. set_config(..., true) is transaction-local.
CREATE OR REPLACE FUNCTION reject_direct_therapy_note_content_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.therapy_note_write_context', true) IS NULL
     OR current_setting('app.therapy_note_write_context', true) NOT IN ('signing', 'erasure') THEN
    RAISE EXCEPTION 'therapy_notes.content may only change in a signing or erasure transaction';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "therapy_notes_signed_content_guard" ON "therapy_notes";
CREATE TRIGGER "therapy_notes_signed_content_guard"
BEFORE UPDATE OF "content" ON "therapy_notes"
FOR EACH ROW EXECUTE FUNCTION reject_direct_therapy_note_content_update();

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTE_DRAFT_EDITED';
