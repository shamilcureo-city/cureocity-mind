-- Sprint 8 PR 1 — ClientClaimToken for QR-based patient onboarding.
-- Single-use, short-lived tokens. Psychologist issues one per client; the
-- client's PWA scans the QR and POSTs to /claim-tokens/:token/redeem after
-- Firebase phone OTP, which sets Client.clientFirebaseUid.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CLIENT_CLAIM_TOKEN_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE 'CLIENT_CLAIM_TOKEN_REDEEMED';

-- CreateTable
CREATE TABLE "client_claim_tokens" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedByFirebaseUid" TEXT,

    CONSTRAINT "client_claim_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_claim_tokens_token_key" ON "client_claim_tokens"("token");

-- CreateIndex
CREATE INDEX "client_claim_tokens_clientId_expiresAt_idx" ON "client_claim_tokens"("clientId", "expiresAt");

-- AddForeignKey
ALTER TABLE "client_claim_tokens" ADD CONSTRAINT "client_claim_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
