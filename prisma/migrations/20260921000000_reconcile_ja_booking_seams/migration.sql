-- Fix forward for fresh-database histories.
--
-- 20260811093000_ja_booking_seams predates the migration that creates the
-- Appointment table and AppointmentStatus enum. Fresh CI databases therefore
-- record that historical migration as applied without executing it. Recreate
-- its two intended indexes here, after all prerequisites exist. Production
-- databases that already have the indexes safely no-op.

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_psychologistId_startAt_active_key"
ON "Appointment" ("psychologistId", "startAt")
WHERE "status" IN ('REQUESTED'::"AppointmentStatus", 'CONFIRMED'::"AppointmentStatus");

CREATE UNIQUE INDEX IF NOT EXISTS "clients_psychologistId_demo_key"
ON "clients" ("psychologistId")
WHERE "isDemo" = true;