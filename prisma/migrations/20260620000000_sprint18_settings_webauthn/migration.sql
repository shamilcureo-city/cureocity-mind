-- Sprint 18 — Therapist settings + WebAuthn credentials.
--
-- Adds:
--   * Three new Psychologist columns for self-service preferences +
--     account recovery (defaultOutputLanguage, defaultModality,
--     backupEmail).
--   * webauthn_credentials table — one row per registered platform
--     authenticator. Sign route enforces "assertion required" when
--     a psychologist has ≥1 non-revoked row.
--   * Two new AuditAction values.
--
-- PSYCHOLOGIST_UPDATED is already in the enum (added Sprint 1) and
-- wired by the new PATCH /api/v1/psychologists/me route added in
-- the same sprint.

-- ---------------------------------------------------------------------------
-- AuditAction additions
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'WEBAUTHN_CREDENTIAL_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'WEBAUTHN_CREDENTIAL_REVOKED';

-- ---------------------------------------------------------------------------
-- Psychologist new columns
-- ---------------------------------------------------------------------------

ALTER TABLE "psychologists"
    ADD COLUMN "defaultOutputLanguage" TEXT NOT NULL DEFAULT 'en';

ALTER TABLE "psychologists"
    ADD COLUMN "defaultModality" TEXT;

ALTER TABLE "psychologists"
    ADD COLUMN "backupEmail" TEXT;

-- ---------------------------------------------------------------------------
-- webauthn_credentials
-- ---------------------------------------------------------------------------

CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key"
    ON "webauthn_credentials"("credentialId");
CREATE INDEX "webauthn_credentials_psychologistId_revokedAt_idx"
    ON "webauthn_credentials"("psychologistId", "revokedAt");

ALTER TABLE "webauthn_credentials"
    ADD CONSTRAINT "webauthn_credentials_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
