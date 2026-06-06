-- Sprint 19 — Scribing flow revamp.
--
-- Relaxes Session.modality to nullable so first-session intakes can
-- be created without forcing a modality choice before assessment.
-- Adds SessionKind enum + Session.kind column to drive Pass 2/3
-- prompt branching (intake-note vs treatment-note vs review-verdict).
-- Expands SessionModality with 7 evidence-based options + INTAKE
-- so the picker isn't forced to collapse ACT/IFS/MI/MBCT/etc. into
-- the "Other" bucket.
--
-- Two new AuditAction values track the session-defaults cascade
-- (inferred = picked by helper; overridden = therapist edited the
-- cascade-picked value).

-- ---------------------------------------------------------------------------
-- Expanded SessionModality.
-- ---------------------------------------------------------------------------

ALTER TYPE "SessionModality" ADD VALUE IF NOT EXISTS 'ACT';
ALTER TYPE "SessionModality" ADD VALUE IF NOT EXISTS 'IFS';
ALTER TYPE "SessionModality" ADD VALUE IF NOT EXISTS 'PSYCHODYNAMIC';
ALTER TYPE "SessionModality" ADD VALUE IF NOT EXISTS 'MI';
ALTER TYPE "SessionModality" ADD VALUE IF NOT EXISTS 'MBCT';
ALTER TYPE "SessionModality" ADD VALUE IF NOT EXISTS 'SUPPORTIVE';
ALTER TYPE "SessionModality" ADD VALUE IF NOT EXISTS 'INTAKE';

-- ---------------------------------------------------------------------------
-- SessionKind enum + Session.kind column.
-- ---------------------------------------------------------------------------

CREATE TYPE "SessionKind" AS ENUM ('INTAKE', 'TREATMENT', 'REVIEW');

ALTER TABLE "sessions"
    ADD COLUMN "kind" "SessionKind" NOT NULL DEFAULT 'TREATMENT';

-- ---------------------------------------------------------------------------
-- Modality becomes nullable.
-- ---------------------------------------------------------------------------

ALTER TABLE "sessions" ALTER COLUMN "modality" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- AuditAction additions.
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_MODALITY_INFERRED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_MODALITY_OVERRIDDEN';
