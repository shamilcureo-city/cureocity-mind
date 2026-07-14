-- P3 — Care landing waitlist (public capture while sign-ups stay gated)
-- + its audit action.
CREATE TABLE IF NOT EXISTS "care_waitlist_entries" (
    "id" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_waitlist_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "care_waitlist_entries_contact_key"
    ON "care_waitlist_entries"("contact");

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_WAITLIST_JOINED';
