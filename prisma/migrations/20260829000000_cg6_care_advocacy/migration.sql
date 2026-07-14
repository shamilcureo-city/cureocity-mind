-- CG6 — Care advocacy + graduation (docs/CARE_GROWTH_SYSTEM.md §8/§12).
-- Idempotent per the per-sprint migration convention (CLAUDE.md §4).

ALTER TABLE "care_users" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "care_users" ADD COLUMN IF NOT EXISTS "graduatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "care_users_referralCode_key" ON "care_users"("referralCode");

CREATE TABLE IF NOT EXISTS "care_share_cards" (
    "id" TEXT NOT NULL,
    "careUserId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_share_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "care_share_cards_token_key" ON "care_share_cards"("token");
CREATE INDEX IF NOT EXISTS "care_share_cards_careUserId_createdAt_idx" ON "care_share_cards"("careUserId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "care_share_cards" ADD CONSTRAINT "care_share_cards_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "care_referrals" (
    "id" TEXT NOT NULL,
    "referrerCareUserId" TEXT NOT NULL,
    "redeemerCareUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SIGNED_UP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditedAt" TIMESTAMP(3),

    CONSTRAINT "care_referrals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "care_referrals_redeemerCareUserId_key" ON "care_referrals"("redeemerCareUserId");
CREATE INDEX IF NOT EXISTS "care_referrals_referrerCareUserId_creditedAt_idx" ON "care_referrals"("referrerCareUserId", "creditedAt");

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SHARE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SHARE_OPENED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SHARE_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_REFERRAL_LINKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_REFERRAL_CREDITED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_GRADUATED';
