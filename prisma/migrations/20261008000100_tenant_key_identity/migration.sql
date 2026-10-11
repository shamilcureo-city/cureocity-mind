-- Preserve every wrapped DEK: legacy ciphertext may reference any of them.
-- Keep the deterministic newest row active before enforcing one active key.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "psychologistId" ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "psychologist_tenant_keys" WHERE "retiredAt" IS NULL
)
UPDATE "psychologist_tenant_keys" AS keys
SET "retiredAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE keys."id" = ranked."id" AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "psychologist_tenant_keys_one_active"
ON "psychologist_tenant_keys" ("psychologistId") WHERE "retiredAt" IS NULL;
