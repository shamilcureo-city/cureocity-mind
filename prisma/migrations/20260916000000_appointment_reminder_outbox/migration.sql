-- Durable appointment reminder outbox. Replay-safe by convention.
DO $$ BEGIN
  CREATE TYPE "AppointmentReminderKind" AS ENUM ('24H', '2H');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentReminderDeliveryStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "appointment_reminder_deliveries" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "kind" "AppointmentReminderKind" NOT NULL,
  "status" "AppointmentReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  "providerIdempotencyKey" TEXT NOT NULL,
  "lastError" VARCHAR(128),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_reminder_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_reminder_deliveries_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_reminder_deliveries_appointmentId_kind_key"
  ON "appointment_reminder_deliveries"("appointmentId", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_reminder_deliveries_providerIdempotencyKey_key"
  ON "appointment_reminder_deliveries"("providerIdempotencyKey");
CREATE INDEX IF NOT EXISTS "appointment_reminder_deliveries_status_leaseExpiresAt_idx"
  ON "appointment_reminder_deliveries"("status", "leaseExpiresAt");

-- Preserve compatibility with installations where the old marker represented
-- an already-attempted reminder. This prevents deployment from replaying those
-- legacy logical deliveries. New markers are written only after DELIVERED.
INSERT INTO "appointment_reminder_deliveries" (
  "id", "appointmentId", "kind", "status", "attemptCount",
  "providerIdempotencyKey", "deliveredAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-24h-' || "id", "id", '24H', 'DELIVERED', 1,
  'appointment-reminder:' || "id" || ':24H', "reminded24At", "reminded24At", "reminded24At"
FROM "appointments"
WHERE "reminded24At" IS NOT NULL
ON CONFLICT ("appointmentId", "kind") DO NOTHING;

INSERT INTO "appointment_reminder_deliveries" (
  "id", "appointmentId", "kind", "status", "attemptCount",
  "providerIdempotencyKey", "deliveredAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-2h-' || "id", "id", '2H', 'DELIVERED', 1,
  'appointment-reminder:' || "id" || ':2H', "reminded2At", "reminded2At", "reminded2At"
FROM "appointments"
WHERE "reminded2At" IS NOT NULL
ON CONFLICT ("appointmentId", "kind") DO NOTHING;
