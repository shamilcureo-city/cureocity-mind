-- Version reminder deliveries by the appointment schedule they describe.
ALTER TYPE "AppointmentReminderDeliveryStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "appointment_reminder_deliveries"
  ADD COLUMN IF NOT EXISTS "scheduledStartAt" TIMESTAMP(3);

-- Rows from the pre-versioned schema cannot prove which schedule they describe.
-- Re-enqueueing the current schedule is safer than dispatching an old one.
DELETE FROM "appointment_reminder_deliveries"
WHERE "status" <> 'DELIVERED';

-- Preserve delivered history. A still-present compatibility marker means the
-- delivery belongs to the current schedule; a cleared marker means reschedule
-- already occurred, so use a historical sentinel that cannot block generation
-- for the appointment's current start.
UPDATE "appointment_reminder_deliveries" AS delivery
SET "scheduledStartAt" = CASE
  WHEN (
    delivery."kind" = '24H'::"AppointmentReminderKind"
    AND appointment."reminded24At" = delivery."deliveredAt"
  ) OR (
    delivery."kind" = '2H'::"AppointmentReminderKind"
    AND appointment."reminded2At" = delivery."deliveredAt"
  ) THEN appointment."startAt"
  ELSE delivery."createdAt"
END
FROM "appointments" AS appointment
WHERE appointment."id" = delivery."appointmentId"
  AND delivery."scheduledStartAt" IS NULL;

ALTER TABLE "appointment_reminder_deliveries"
  ALTER COLUMN "scheduledStartAt" SET NOT NULL;

DROP INDEX IF EXISTS "appointment_reminder_deliveries_appointmentId_kind_key";
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_key"
  ON "appointment_reminder_deliveries"("appointmentId", "scheduledStartAt", "kind");