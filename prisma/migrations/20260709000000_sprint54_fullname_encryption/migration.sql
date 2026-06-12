-- Sprint 54 — bring Client.fullName into the envelope-encryption rollout.
--
-- Phone + email already dual-write their encrypted companions (Sprint 32
-- Phase 1) across create / update / DSR-correction + a backfill route.
-- The patient's NAME — the single most sensitive PII field — had no
-- encrypted column at all, so it was the one piece of Client PII with
-- zero at-rest protection on the roadmap.
--
-- This is the additive half of the rollout: a new nullable column that
-- the write paths populate alongside the plaintext. It introduces NO
-- read dependency and drops NO plaintext, so it is fully reversible and
-- safe to ship ahead of the prod-data-dependent read-cutover +
-- plaintext-drop step (which also waits on the AWS-KMS asia-south1
-- procurement decision tracked in tenant-crypto.ts).

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "fullNameEncrypted" TEXT;
