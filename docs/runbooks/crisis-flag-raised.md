# Crisis flag raised

**Severity:** page (clinical on-call). **SLA:** acknowledge in 15 min.

## What this means

A NoteDraft just landed with `riskFlags.severity` of `high` or
`critical`. Pass 2 of the Gemini pipeline detected language consistent
with active suicidal ideation, plan, intent, or other imminent harm.
The therapist who conducted the session has been notified in the
review screen, but they may be off-shift.

This alert is the platform's safety net — it fires regardless of
whether the therapist has opened the review screen yet.

## Immediate actions (first 5 minutes)

1. Open the audit log filter:
   `GET /api/v1/admin/audit-logs?action=CRISIS_FLAG_RAISED&from=<now-30m>`
2. For each row, note `metadata.sessionId` and `metadata.psychologistId`.
3. Cross-check the assigned therapist's availability (their on-call
   roster lives in the staff directory; not yet automated).
4. If the therapist is unreachable within 10 minutes, escalate to the
   backup clinician per the safety protocol.

## Verifying the flag is real (next 10 minutes)

1. Fetch the draft:
   `GET /api/v1/sessions/:sessionId/note-draft` (admin Bearer token).
2. Read `content.riskFlags` plus `content.subjective` and
   `content.assessment` for context.
3. The `riskFlags.indicators` array names the specific Pass 2
   detectors that fired (e.g. `suicidal_ideation_with_plan`,
   `homicidal_ideation`, `severe_dissociation`).
4. **Do NOT** call or message the client directly from the platform
   admin role — the clinical relationship lives with the therapist,
   not Cureocity Mind. Escalation goes through the therapist or, if
   they're unreachable, the backup clinician.

## False-positive handling

If after review the crisis flag is judged a false positive (the
language was clinical reporting, not active risk):

1. The therapist marks the risk as reviewed via the review-screen
   acknowledgement checkbox (writes `NOTE_SIGNED` with
   `metadata.riskAcked=true`).
2. File the false positive into the prompt-eval queue
   (`docs/prompts/missed.md` — Sprint 5 backlog).

## Mitigating / silencing the alert

There is no silence window for this alert. Every fire requires a
human review even when the rate is high. If volume becomes
operationally untenable (>10 / day), revisit the Pass 2 prompt
thresholds with the clinical lead — but **never** silence without
that conversation.

## Related

- Pass 2 prompt source: `packages/llm/src/prompts/pass2-note.ts`
- Schema: `prisma/schema.prisma` (`NoteRiskSeverity` enum)
- Audit: `AuditAction.CRISIS_FLAG_RAISED`
