-- Sprint DS1 — the live findings extractor pass (reasoning substrate).
-- Guarded / idempotent so a re-run or the P3009 self-heal is safe.
ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_10_FINDINGS';
