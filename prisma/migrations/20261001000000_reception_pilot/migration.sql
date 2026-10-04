-- Additive, opt-in reception pilot. This migration does not publish any desk.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "suppressAutomaticMessages" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "reception_settings" (
  "psychologistId" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reception_settings_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reception_settings_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE IF NOT EXISTS "reception_requests" (
  "id" TEXT PRIMARY KEY,
  "psychologistId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "submissionHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "payloadEncrypted" TEXT NOT NULL,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "mode" TEXT,
  "clientId" TEXT,
  "sessionId" TEXT UNIQUE,
  "appointmentId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reception_requests_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reception_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reception_requests_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reception_requests_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reception_requests_kind_check" CHECK ("kind" IN ('BOOKING', 'CANCEL', 'RESCHEDULE', 'QUESTION')),
  CONSTRAINT "reception_requests_status_check" CHECK ("status" IN ('NEW', 'BOOKED', 'DECLINED', 'RESOLVED')),
  CONSTRAINT "reception_requests_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "reception_requests_slot_check" CHECK ("kind" <> 'BOOKING' OR ("startAt" IS NOT NULL AND "endAt" > "startAt" AND "mode" IN ('ONLINE', 'IN_PERSON'))),
  CONSTRAINT "reception_requests_approval_check" CHECK ("status" <> 'BOOKED' OR ("kind" = 'BOOKING' AND "clientId" IS NOT NULL AND "sessionId" IS NOT NULL AND "appointmentId" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "reception_requests_psychologistId_submissionId_key" ON "reception_requests"("psychologistId", "submissionId");
CREATE INDEX IF NOT EXISTS "reception_requests_psychologistId_status_createdAt_idx" ON "reception_requests"("psychologistId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "reception_requests_clientId_idx" ON "reception_requests"("clientId");

CREATE TABLE IF NOT EXISTS "reception_events" (
  "id" TEXT PRIMARY KEY,
  "psychologistId" TEXT NOT NULL,
  "requestId" TEXT,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reception_events_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reception_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "reception_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "reception_events_psychologistId_createdAt_idx" ON "reception_events"("psychologistId", "createdAt");
CREATE INDEX IF NOT EXISTS "reception_events_requestId_idx" ON "reception_events"("requestId");

CREATE TABLE IF NOT EXISTS "reception_rate_limits" (
  "key" TEXT PRIMARY KEY,
  "hits" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reception_rate_limits_hits_check" CHECK ("hits" > 0)
);
CREATE INDEX IF NOT EXISTS "reception_rate_limits_resetAt_idx" ON "reception_rate_limits"("resetAt");
