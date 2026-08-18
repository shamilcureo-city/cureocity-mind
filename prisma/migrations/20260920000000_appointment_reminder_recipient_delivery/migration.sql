-- Replace the provider-idempotency fiction with one PHI-free row per recipient.
-- SendGrid /v3/mail/send has no documented idempotency contract. Automatic
-- delivery is therefore at-most-once: after SUBMISSION_STARTED, a crash may
-- miss a reminder and manual reconciliation is required.
DO $$ BEGIN
  CREATE TYPE "AppointmentReminderRecipient" AS ENUM (
    'PRACTITIONER_EMAIL',
    'PATIENT_EMAIL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TYPE "AppointmentReminderDeliveryStatus"
  ADD VALUE IF NOT EXISTS 'DISPATCHING';
ALTER TYPE "AppointmentReminderDeliveryStatus"
  ADD VALUE IF NOT EXISTS 'SUBMISSION_STARTED';
ALTER TYPE "AppointmentReminderDeliveryStatus"
  ADD VALUE IF NOT EXISTS 'UNKNOWN';

ALTER TABLE "appointment_reminder_deliveries"
  ADD COLUMN IF NOT EXISTS "recipient" "AppointmentReminderRecipient";
ALTER TABLE "appointment_reminder_deliveries"
  ADD COLUMN IF NOT EXISTS "submissionStartedAt" TIMESTAMP(3);

-- Give the previous deployed writer a recipient immediately. Existing rows
-- remain NULL until the conservative backfill below classifies them.
ALTER TABLE "appointment_reminder_deliveries"
  ALTER COLUMN "recipient" SET DEFAULT 'PRACTITIONER_EMAIL';

-- This block runs only while the legacy column exists. Legacy FAILED/IN_FLIGHT rows may
-- already have submitted one or both combined sends, so UNKNOWN is the only
-- duplicate-safe conservative backfill. PENDING is known not to have submitted.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'appointment_reminder_deliveries'
      AND column_name = 'providerIdempotencyKey'
  ) AND EXISTS (SELECT 1 FROM "appointment_reminder_deliveries" WHERE "recipient" IS NULL) THEN
    UPDATE "appointment_reminder_deliveries"
    SET "status" = CASE
      WHEN "status" = 'DELIVERED' THEN 'DELIVERED'
      WHEN "status" IN ('IN_FLIGHT', 'FAILED') THEN 'UNKNOWN'
      ELSE "status"
    END;

    UPDATE "appointment_reminder_deliveries"
    SET "recipient" = 'PRACTITIONER_EMAIL'
    WHERE "recipient" IS NULL;

  END IF;
END $$;

-- Establish the replacement uniqueness constraint before removing either
-- legacy constraint. This keeps concurrent old/new writers duplicate-safe at
-- every migration boundary and also makes a replay after partial DDL safe.
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_recipient_key"
  ON "appointment_reminder_deliveries"("appointmentId", "scheduledStartAt", "kind", "recipient");

DROP INDEX IF EXISTS "appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_key";

-- The legacy patient copy must happen after the old three-column uniqueness
-- constraint is gone. Keep it in its own atomic block so replay can finish a
-- migration interrupted between the index transition and this insert.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'appointment_reminder_deliveries'
      AND column_name = 'providerIdempotencyKey'
  ) THEN
    INSERT INTO "appointment_reminder_deliveries" (
      "id",
      "appointmentId",
      "scheduledStartAt",
      "kind",
      "recipient",
      "status",
      "attemptCount",
      "leaseExpiresAt",
      "providerIdempotencyKey",
      "lastError",
      "deliveredAt",
      "createdAt",
      "updatedAt"
    )
    SELECT
      'recipient-patient-' || delivery."id",
      delivery."appointmentId",
      delivery."scheduledStartAt",
      delivery."kind",
      'PATIENT_EMAIL'::"AppointmentReminderRecipient",
      delivery."status",
      delivery."attemptCount",
      NULL,
      delivery."providerIdempotencyKey" || ':legacy-patient',
      delivery."lastError",
      delivery."deliveredAt",
      delivery."createdAt",
      delivery."updatedAt"
    FROM "appointment_reminder_deliveries" AS delivery
    INNER JOIN "Appointment" AS appointment
      ON appointment."id" = delivery."appointmentId"
    WHERE delivery."recipient" = 'PRACTITIONER_EMAIL'
      AND appointment."patientEmailEncrypted" IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

ALTER TABLE "appointment_reminder_deliveries"
  ALTER COLUMN "recipient" SET NOT NULL;
-- Keep the deprecated column nullable for zero-downtime compatibility with the
-- previously deployed writer. New code neither writes nor sends this value.
ALTER TABLE "appointment_reminder_deliveries"
  ALTER COLUMN "providerIdempotencyKey" DROP NOT NULL;

DROP INDEX IF EXISTS "appointment_reminder_deliveries_providerIdempotencyKey_key";
