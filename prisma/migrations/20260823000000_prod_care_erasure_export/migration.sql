-- PROD7/PROD8 — Care erasure purge + data export audit actions.
-- CARE_ACCOUNT_PURGED: the retention sweeper hard-deleted a DELETED
--   tombstone past its grace window (transcripts/reports cascade).
-- CARE_DATA_EXPORTED: a Care user downloaded their data (DPDP §11 access,
--   promised by the onboarding consent copy).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_ACCOUNT_PURGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_DATA_EXPORTED';
