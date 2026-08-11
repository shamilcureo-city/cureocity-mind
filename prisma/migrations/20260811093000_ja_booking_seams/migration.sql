-- Journey audit (JA-G) — booking seams.
--
-- 1) Slot race: two racing public bookings could both hold the same slot —
--    the route's "serialized re-check" read through the global client at
--    READ COMMITTED, and nothing enforced uniqueness. A partial unique
--    index makes the database the arbiter: at most one holding
--    (REQUESTED/CONFIRMED) appointment per (psychologist, startAt).
--    Cancelled/expired/declined rows stay out of the way so the slot can
--    be re-booked.
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_psychologistId_startAt_active_key"
ON "Appointment" ("psychologistId", "startAt")
WHERE "status" IN ('REQUESTED'::"AppointmentStatus", 'CONFIRMED'::"AppointmentStatus");

-- 2) Demo-seed race (JA-I): the onboarding after() auto-seed and the
--    manual "Seed it" button could both pass the find-then-create check and
--    mint two demo arcs. At most one demo client per psychologist.
CREATE UNIQUE INDEX IF NOT EXISTS "clients_psychologistId_demo_key"
ON "clients" ("psychologistId")
WHERE "isDemo" = true;
