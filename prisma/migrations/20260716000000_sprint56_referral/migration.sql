-- Sprint 56 (Lever 3b) — referral program.
-- Two tables + two audit verbs. Idempotent.

CREATE TABLE IF NOT EXISTS "referral_codes" (
  "id"             TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "referral_codes_psychologistId_key" ON "referral_codes" ("psychologistId");
CREATE UNIQUE INDEX IF NOT EXISTS "referral_codes_code_key" ON "referral_codes" ("code");

CREATE TABLE IF NOT EXISTS "referral_redemptions" (
  "id"                     TEXT NOT NULL,
  "code"                   TEXT NOT NULL,
  "referrerPsychologistId" TEXT NOT NULL,
  "referredPsychologistId" TEXT NOT NULL,
  "rewardGrantedAt"        TIMESTAMP(3),
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "referral_redemptions_referredPsychologistId_key" ON "referral_redemptions" ("referredPsychologistId");
CREATE INDEX IF NOT EXISTS "referral_redemptions_referrerPsychologistId_idx" ON "referral_redemptions" ("referrerPsychologistId");
CREATE INDEX IF NOT EXISTS "referral_redemptions_code_idx" ON "referral_redemptions" ("code");

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_REDEEMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFERRAL_REWARDED';
