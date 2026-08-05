-- VS1 — virtual sessions from the Record screen: audit the client joining a
-- session video room via the signed link. Guarded for the P3009 self-heal.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'VIDEO_SESSION_CLIENT_JOINED';
