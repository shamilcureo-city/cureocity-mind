-- Sprint 9 PR 2 — DSR persistence (DPDP Act §§ 14–16).

-- CreateEnum
CREATE TYPE "DsrErasureStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED');
CREATE TYPE "DsrGrievanceStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED');

-- CreateTable: ClientNomination
CREATE TABLE "client_nominations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "nomineeName" TEXT NOT NULL,
    "nomineeRelation" TEXT NOT NULL,
    "nomineePhone" TEXT NOT NULL,
    "nomineeEmail" TEXT,
    "notes" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_nominations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_nominations_clientId_supersededAt_idx" ON "client_nominations"("clientId", "supersededAt");

ALTER TABLE "client_nominations" ADD CONSTRAINT "client_nominations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ClientErasureRequest
CREATE TABLE "client_erasure_requests" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "DsrErasureStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "resolvedByPsychologistId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_erasure_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_erasure_requests_clientId_status_idx" ON "client_erasure_requests"("clientId", "status");
CREATE INDEX "client_erasure_requests_status_createdAt_idx" ON "client_erasure_requests"("status", "createdAt");

ALTER TABLE "client_erasure_requests" ADD CONSTRAINT "client_erasure_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ClientGrievance
CREATE TABLE "client_grievances" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "DsrGrievanceStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_grievances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_grievances_clientId_status_idx" ON "client_grievances"("clientId", "status");
CREATE INDEX "client_grievances_status_createdAt_idx" ON "client_grievances"("status", "createdAt");

ALTER TABLE "client_grievances" ADD CONSTRAINT "client_grievances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
