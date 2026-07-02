-- Sprint DS2 — the combined live reasoning pass (differential + ask-next).
-- Guarded / idempotent so a re-run or the P3009 self-heal is safe.
ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_11_REASONING';
