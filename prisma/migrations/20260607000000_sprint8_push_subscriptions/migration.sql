-- Sprint 8 PR 4 — Web Push subscriptions + notification audit actions.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUSH_SUBSCRIPTION_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE 'PUSH_SUBSCRIPTION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_DISPATCHED';
ALTER TYPE "AuditAction" ADD VALUE 'TREATMENT_PLAN_WHATSAPP_SENT';

-- CreateTable
CREATE TABLE "client_push_subscriptions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_push_subscriptions_endpoint_key" ON "client_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "client_push_subscriptions_clientId_revokedAt_idx" ON "client_push_subscriptions"("clientId", "revokedAt");

-- AddForeignKey
ALTER TABLE "client_push_subscriptions" ADD CONSTRAINT "client_push_subscriptions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
