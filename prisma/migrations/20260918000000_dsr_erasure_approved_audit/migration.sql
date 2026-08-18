-- DPDP erasure approval is a distinct decision from successful fulfilment.
-- PostgreSQL enum additions are append-only; the route starts using this value
-- only after this migration has deployed.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DSR_ERASURE_APPROVED';
