-- Read-only, aggregate-only preflight. Run against an explicitly authorized
-- database with the same search_path as Prisma. Does not pause writers.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

WITH duplicate_groups AS (
  SELECT count(*) AS delivery_count
  FROM "appointment_reminder_deliveries"
  GROUP BY "appointmentId", "scheduledStartAt", "kind", "recipient"
  HAVING count(*) > 1
)
SELECT
  count(*) AS duplicate_identity_groups,
  coalesce(sum(delivery_count), 0) AS rows_in_duplicate_groups,
  coalesce(sum(delivery_count - 1), 0) AS excess_rows
FROM duplicate_groups;

-- Missing/wrong canonical index is not repaired by this read-only script.
-- A zero duplicate count is only a snapshot; the migration locks writers and
-- repeats its checks before creating and validating the index atomically.
SELECT
  index_class.oid IS NOT NULL AS canonical_index_present,
  index_info.indrelid = '"appointment_reminder_deliveries"'::regclass AS correct_table,
  access_method.amname AS access_method,
  index_info.indisunique AS is_unique,
  index_info.indisvalid AS is_valid,
  index_info.indisready AS is_ready,
  index_info.indislive AS is_live,
  index_info.indimmediate AS is_immediate,
  index_info.indnkeyatts AS key_count,
  index_info.indnatts AS total_attribute_count,
  index_info.indpred IS NULL AS has_no_predicate,
  index_info.indexprs IS NULL AS has_no_expression,
  (
    SELECT array_agg(attribute.attname::text ORDER BY key.position)
    FROM unnest(index_info.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_info.indrelid AND attribute.attnum = key.attnum
  ) AS indexed_columns,
  (
    SELECT count(*) = 4
    FROM pg_attribute
    WHERE attrelid = target_table.oid
      AND attname IN ('appointmentId', 'scheduledStartAt', 'kind', 'recipient')
      AND attnotnull AND NOT attisdropped
  ) AS identity_columns_not_null
FROM pg_class AS target_table
LEFT JOIN pg_class AS index_class
  ON index_class.relnamespace = target_table.relnamespace
  AND index_class.relname = 'appointment_reminder_delivery_identity_key'
LEFT JOIN pg_index AS index_info ON index_info.indexrelid = index_class.oid
LEFT JOIN pg_am AS access_method ON access_method.oid = index_class.relam
WHERE target_table.oid = '"appointment_reminder_deliveries"'::regclass;

COMMIT;
