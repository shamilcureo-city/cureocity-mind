-- CG2 — Care first-day arc (docs/CARE_GROWTH_SYSTEM.md §12).
-- Two audit actions: the reveal's resonance check (the in-product
-- assessment-quality signal) and the session-3 alliance pulse (WAI-SR-short,
-- the leading retention indicator). Idempotent per CLAUDE.md §4.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_ASSESSMENT_RESONANCE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_ALLIANCE_PULSE';
