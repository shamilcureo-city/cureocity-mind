-- Fix forward: the historical old/new index names shared the same first
-- 63 bytes, so PostgreSQL skipped the replacement and then dropped the old
-- index. Do not edit those applied migrations or delete delivery history.
-- Coordinate a short reminder-writer pause before an authorized rollout.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Hold writers out between duplicate inspection and index installation.
-- Reads remain available. A busy table fails within the bounded lock timeout.
LOCK TABLE "appointment_reminder_deliveries" IN SHARE MODE;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_attribute
    WHERE attrelid = '"appointment_reminder_deliveries"'::regclass
      AND attname IN ('appointmentId', 'scheduledStartAt', 'kind', 'recipient')
      AND attnotnull
      AND NOT attisdropped
  ) <> 4 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'Reminder identity columns must exist and be NOT NULL before uniqueness repair.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "appointment_reminder_deliveries"
    GROUP BY "appointmentId", "scheduledStartAt", "kind", "recipient"
    HAVING count(*) > 1
  ) THEN
    -- Deliberately omit IDs, recipients, addresses and delivery contents.
    -- A human must reconcile any existing duplicates with submission history.
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Duplicate reminder delivery identities exist. Uniqueness repair stopped without changing history; reconcile duplicates before retrying.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_reminder_delivery_identity_key"
  ON "appointment_reminder_deliveries" ("appointmentId", "scheduledStartAt", "kind", "recipient");

-- IF NOT EXISTS alone accepts any object with this name. Fail closed rather
-- than treating a partial/expression/nonunique/wrong-table index as repaired.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_info
    JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
    JOIN pg_class AS target_table ON target_table.oid = index_info.indrelid
    JOIN pg_am AS access_method ON access_method.oid = index_class.relam
    WHERE index_class.relname = 'appointment_reminder_delivery_identity_key'
      AND index_class.relnamespace = target_table.relnamespace
      AND index_info.indrelid = '"appointment_reminder_deliveries"'::regclass
      AND access_method.amname = 'btree'
      AND index_info.indisunique
      AND index_info.indisvalid
      AND index_info.indisready
      AND index_info.indislive
      AND index_info.indimmediate
      AND index_info.indnkeyatts = 4
      AND index_info.indnatts = 4
      AND index_info.indpred IS NULL
      AND index_info.indexprs IS NULL
      AND (
        SELECT array_agg(attribute.attname::text ORDER BY key.position)
        FROM unnest(index_info.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = index_info.indrelid AND attribute.attnum = key.attnum
      ) = ARRAY['appointmentId', 'scheduledStartAt', 'kind', 'recipient']::text[]
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Reminder identity index has an unexpected definition. Uniqueness repair stopped without replacing existing objects.';
  END IF;
END $$;

COMMIT;
