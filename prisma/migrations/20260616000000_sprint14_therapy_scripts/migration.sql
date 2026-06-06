-- Sprint 14 — Therapy Script (Pass 4).
--
-- Adds the TherapyScript cache table + two new AuditAction enum
-- values + one new GeminiPass enum value. Pass 4 produces a
-- step-by-step in-session script for a named therapy, grounded in
-- the client's primary diagnosis and active treatment plan. Output
-- is cached per (client, cacheKey) to avoid re-billing on re-views.

-- ---------------------------------------------------------------------------
-- GeminiPass enum — PASS_4_THERAPY_SCRIPT
-- ---------------------------------------------------------------------------

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_4_THERAPY_SCRIPT';

-- ---------------------------------------------------------------------------
-- AuditAction enum — two new values for Sprint 14
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THERAPY_SCRIPT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THERAPY_SCRIPT_VIEWED';

-- ---------------------------------------------------------------------------
-- TherapyScript
-- ---------------------------------------------------------------------------

CREATE TABLE "therapy_scripts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "therapyName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "sourceTreatmentPlanId" TEXT,
    "sourcePrimaryDiagnosisId" TEXT,
    "totalCostInr" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "therapy_scripts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "therapy_scripts_clientId_cacheKey_key"
    ON "therapy_scripts"("clientId", "cacheKey");
CREATE INDEX "therapy_scripts_clientId_therapyName_idx"
    ON "therapy_scripts"("clientId", "therapyName");
CREATE INDEX "therapy_scripts_psychologistId_createdAt_idx"
    ON "therapy_scripts"("psychologistId", "createdAt");

ALTER TABLE "therapy_scripts"
    ADD CONSTRAINT "therapy_scripts_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "therapy_scripts"
    ADD CONSTRAINT "therapy_scripts_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "therapy_scripts"
    ADD CONSTRAINT "therapy_scripts_sourceTreatmentPlanId_fkey"
    FOREIGN KEY ("sourceTreatmentPlanId") REFERENCES "treatment_plans"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "therapy_scripts"
    ADD CONSTRAINT "therapy_scripts_sourcePrimaryDiagnosisId_fkey"
    FOREIGN KEY ("sourcePrimaryDiagnosisId") REFERENCES "client_diagnoses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
