-- Sprint DS10-B — plan composer: the doctor edits the draft Rx pad
-- (adopt an AI suggestion / add manually / confirm / remove). One audit
-- row per op is the prescribing trail.
--
-- Idempotent (safe to replay after a P3009 self-heal).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RX_PAD_EDITED';
