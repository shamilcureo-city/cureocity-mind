-- Lawful DPDP erasure for signed-note PHI. The function is owner-controlled,
-- SECURITY DEFINER, and exposes only a request-scoped operation to runtime.

CREATE OR REPLACE FUNCTION allow_lawful_signature_version_erasure()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  relation_owner name;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO relation_owner
  FROM pg_class c WHERE c.oid = TG_RELID;
  IF current_setting('app.note_signature_erasure_context', true) = 'lawful_erasure'
     AND current_user = relation_owner THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'note_signature_versions is append-only';
END;
$$;

DROP TRIGGER IF EXISTS "note_signature_versions_append_only" ON "note_signature_versions";
CREATE TRIGGER "note_signature_versions_append_only"
BEFORE UPDATE OR DELETE ON "note_signature_versions"
FOR EACH ROW EXECUTE FUNCTION allow_lawful_signature_version_erasure();

CREATE OR REPLACE FUNCTION redact_client_signed_note_phi(
  erasure_request_id TEXT,
  resolving_psychologist_id TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_client_id TEXT;
  redacted_count INTEGER;
BEGIN
  SELECT r."clientId" INTO target_client_id
  FROM "client_erasure_requests" r
  JOIN "clients" c ON c."id" = r."clientId"
  WHERE r."id" = erasure_request_id
    AND c."psychologistId" = resolving_psychologist_id
    AND r."status" IN ('PENDING', 'APPROVED')
  FOR UPDATE OF r, c;
  IF target_client_id IS NULL THEN
    RAISE EXCEPTION 'erasure request is missing, unauthorized, or no longer actionable';
  END IF;

  PERFORM set_config('app.note_signature_erasure_context', 'lawful_erasure', true);
  PERFORM set_config('app.therapy_note_write_context', 'erasure', true);

  UPDATE "note_signature_versions" v
  SET "content" = '{}'::jsonb, "rxPad" = NULL, "signPayload" = NULL
  FROM "therapy_notes" n, "sessions" s
  WHERE v."therapyNoteId" = n."id"
    AND n."sessionId" = s."id"
    AND s."clientId" = target_client_id;

  UPDATE "therapy_notes" n
  SET "content" = '{}'::jsonb, "rxPad" = NULL, "signPayload" = NULL
  FROM "sessions" s
  WHERE n."sessionId" = s."id" AND s."clientId" = target_client_id;
  GET DIAGNOSTICS redacted_count = ROW_COUNT;
  RETURN redacted_count;
END;
$$;

REVOKE ALL ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT) FROM PUBLIC;
