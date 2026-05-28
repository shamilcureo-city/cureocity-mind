# Cost circuit tripped

**Severity:** page. **SLA:** acknowledge in 30 min.

## What this means

The cost-guard in `scribe-service/src/cost/cost-guard.service.ts`
rejected a Gemini call because either the per-session INR cap
(default ₹50) or the monthly tenant INR cap (default ₹50 000) would
be exceeded.

When tripped, the cost-guard throws `CostCircuitOpenError`. The note-
generation worker (BullMQ) marks the draft `FAILED` with
`errorMessage` set, and the therapist sees an "Awaiting review by
operations" badge on the review screen.

## Immediate actions

1. Filter audit logs:
   `GET /api/v1/admin/audit-logs?action=COST_CIRCUIT_TRIPPED&from=<now-1h>`
2. The `metadata.scope` field distinguishes:
   - `session` — runaway prompt or retry storm on a single session.
   - `monthly` — tenant-level cap (suspect compromised API key or
     adversarial usage).

## Session-scope diagnosis

1. Open the session in `gemini_call_logs`:
   ```
   SELECT pass, status, cost_inr, input_tokens, output_tokens, latency_ms
   FROM gemini_call_logs
   WHERE session_id = :sessionId
   ORDER BY created_at;
   ```
2. Most common cause: retry loop. Pass 2 reads the Pass 1 transcript;
   if Pass 2 fails with a transient error, the worker retries up to
   3× with exponential backoff. A long transcript multiplies cost.
3. Mitigation: bump session cap via env var
   `COST_SESSION_CAP_INR=<higher>` for the duration of recovery, then
   manually re-kick the worker.

## Monthly-scope diagnosis

1. Aggregate cost by psychologist:
   ```
   SELECT s.psychologist_id, SUM(g.cost_inr) AS spent
   FROM gemini_call_logs g
   JOIN sessions s ON g.session_id = s.id
   WHERE g.created_at >= date_trunc('month', NOW())
   GROUP BY s.psychologist_id
   ORDER BY spent DESC;
   ```
2. If a single tenant dominates: contact the therapist, confirm the
   activity is legitimate (e.g. unusually long sessions), and decide
   whether to raise their cap.
3. If multiple tenants: suspect a leaked Vertex AI service-account
   key. Rotate via the GCP console and re-issue.

## Mitigating / clearing the trip

The circuit doesn't auto-reset — it always re-evaluates against the
cap. Raise the cap, ack the alert, and the next request flows.

## Related

- `scribe-service/src/cost/cost-guard.service.ts`
- `AuditAction.COST_CIRCUIT_TRIPPED`
- Sprint 2 plan: per-session and monthly caps (gap G6).
