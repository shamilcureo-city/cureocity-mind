-- MK8 — online video sessions via the therapist's own meeting link, and
-- the appointment's mode captured at booking (drives which of link /
-- address rides the patient emails + .ics). Guarded DDL; mapped names.

ALTER TABLE "psychologists" ADD COLUMN IF NOT EXISTS "videoCallLink" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'ONLINE';
