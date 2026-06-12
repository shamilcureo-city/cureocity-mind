-- Sprint 45 — Today screen.
--
-- Two new SessionStatus transitions become first-class events: a
-- therapist can mark a scheduled session as a no-show (the client
-- never arrived) or as rescheduled (the slot was moved). Both
-- transitions need their own audit action so the competency
-- dashboard, downstream analytics, and the immutable per-client
-- timeline can attribute them separately from the generic
-- SESSION_CANCELLED bucket.
--
-- No table changes — Session.status already carries NO_SHOW and
-- RESCHEDULED values from the original V1 enum (gap G5). This
-- migration only adds the two AuditAction values that the new
-- /sessions/:id/no-show and /sessions/:id/reschedule routes write.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_NO_SHOW';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_RESCHEDULED';
