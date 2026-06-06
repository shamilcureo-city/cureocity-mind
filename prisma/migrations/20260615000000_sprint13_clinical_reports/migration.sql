-- Sprint 13 — Clinical Co-Pilot Pivot.
--
-- Adds Pass 3 (Clinical Analysis) infrastructure:
--   * ClinicalReport (one per session) — Pass 3 output body +
--     per-section confirmation state.
--   * ClientDiagnosis (cumulative, supersedable) — confirmed
--     diagnoses with ICD-11 codes + supporting transcript quotes.
--   * TreatmentPlan (cumulative, versioned) — confirmed treatment
--     plans with measurable goals.
--
-- Also extends the GeminiPass + AuditAction enums and adds per-session
-- + per-client language fields (default "en"); Sprint 16 wires up
-- Malayalam ("ml") through the prompts + UI.

-- ---------------------------------------------------------------------------
-- ClinicalReportStatus enum
-- ---------------------------------------------------------------------------

CREATE TYPE "ClinicalReportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- ---------------------------------------------------------------------------
-- GeminiPass enum value — PASS_3_CLINICAL_ANALYSIS
-- ---------------------------------------------------------------------------

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_3_CLINICAL_ANALYSIS';

-- ---------------------------------------------------------------------------
-- AuditAction enum — five new values for Sprint 13.
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINICAL_REPORT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINICAL_SECTION_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DIAGNOSIS_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CRISIS_ACKNOWLEDGED';

-- ---------------------------------------------------------------------------
-- Session.language + Client.preferredLanguage — ISO 639-1 codes,
-- defaulted to "en" so existing rows continue to validate.
-- ---------------------------------------------------------------------------

ALTER TABLE "sessions"
    ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';

ALTER TABLE "clients"
    ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'en';

-- ---------------------------------------------------------------------------
-- ClinicalReport
-- ---------------------------------------------------------------------------

CREATE TABLE "clinical_reports" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "status" "ClinicalReportStatus" NOT NULL DEFAULT 'PENDING',
    "body" JSONB,
    "confirmations" JSONB NOT NULL DEFAULT '{}',
    "totalCostInr" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_reports_sessionId_key"
    ON "clinical_reports"("sessionId");
CREATE INDEX "clinical_reports_clientId_createdAt_idx"
    ON "clinical_reports"("clientId", "createdAt");
CREATE INDEX "clinical_reports_psychologistId_createdAt_idx"
    ON "clinical_reports"("psychologistId", "createdAt");
CREATE INDEX "clinical_reports_status_createdAt_idx"
    ON "clinical_reports"("status", "createdAt");

ALTER TABLE "clinical_reports"
    ADD CONSTRAINT "clinical_reports_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinical_reports"
    ADD CONSTRAINT "clinical_reports_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinical_reports"
    ADD CONSTRAINT "clinical_reports_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ClientDiagnosis
-- ---------------------------------------------------------------------------

CREATE TABLE "client_diagnoses" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clinicalReportId" TEXT NOT NULL,
    "icd11Code" TEXT NOT NULL,
    "icd11Label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "supportingEvidence" JSONB NOT NULL DEFAULT '[]',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "confirmedByPsychologistId" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_diagnoses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_diagnoses_clientId_supersededAt_idx"
    ON "client_diagnoses"("clientId", "supersededAt");
CREATE INDEX "client_diagnoses_clientId_isPrimary_supersededAt_idx"
    ON "client_diagnoses"("clientId", "isPrimary", "supersededAt");
CREATE INDEX "client_diagnoses_psychologistId_createdAt_idx"
    ON "client_diagnoses"("psychologistId", "createdAt");

ALTER TABLE "client_diagnoses"
    ADD CONSTRAINT "client_diagnoses_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_diagnoses"
    ADD CONSTRAINT "client_diagnoses_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "client_diagnoses"
    ADD CONSTRAINT "client_diagnoses_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "client_diagnoses"
    ADD CONSTRAINT "client_diagnoses_clinicalReportId_fkey"
    FOREIGN KEY ("clinicalReportId") REFERENCES "clinical_reports"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- TreatmentPlan
-- ---------------------------------------------------------------------------

CREATE TABLE "treatment_plans" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "sourceClinicalReportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "confirmedByPsychologistId" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "treatment_plans_clientId_version_key"
    ON "treatment_plans"("clientId", "version");
CREATE INDEX "treatment_plans_clientId_supersededAt_idx"
    ON "treatment_plans"("clientId", "supersededAt");
CREATE INDEX "treatment_plans_psychologistId_createdAt_idx"
    ON "treatment_plans"("psychologistId", "createdAt");

ALTER TABLE "treatment_plans"
    ADD CONSTRAINT "treatment_plans_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "treatment_plans"
    ADD CONSTRAINT "treatment_plans_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "treatment_plans"
    ADD CONSTRAINT "treatment_plans_sourceSessionId_fkey"
    FOREIGN KEY ("sourceSessionId") REFERENCES "sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "treatment_plans"
    ADD CONSTRAINT "treatment_plans_sourceClinicalReportId_fkey"
    FOREIGN KEY ("sourceClinicalReportId") REFERENCES "clinical_reports"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
