-- Sprint 37: pilot invite codes — gate signup behind admin-minted codes.

CREATE TABLE "pilot_invite_codes" (
  "id"                      TEXT NOT NULL,
  "code"                    TEXT NOT NULL,
  "label"                   TEXT,
  "maxUses"                 INTEGER NOT NULL DEFAULT 1,
  "usedCount"               INTEGER NOT NULL DEFAULT 0,
  "createdByPsychologistId" TEXT,
  "expiresAt"               TIMESTAMP(3),
  "revokedAt"               TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pilot_invite_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pilot_invite_codes_code_key" ON "pilot_invite_codes" ("code");
CREATE INDEX "pilot_invite_codes_revokedAt_idx" ON "pilot_invite_codes" ("revokedAt");

-- Audit actions
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PILOT_INVITE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PILOT_INVITE_REDEEMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PILOT_INVITE_REVOKED';
