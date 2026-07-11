# Cost circuit tripped

**Severity:** page. **SLA:** acknowledge in 30 min.

## What this means

The cost-guard in `apps/web/lib/cost-guard.ts` rejected a Gemini call
because either the per-session INR cap (`COST_CAP_PER_SESSION_INR`,
default ₹500) or the monthly tenant INR cap
(`COST_CAP_PER_THERAPIST_MONTHLY_INR`, default ₹15 000) would be
exceeded. The session-less practice-assistant chat goes through the
monthly-only leg (`checkMonthlyCostCircuit`) and returns 429 when
tripped. The live gateway additionally has its own per-consult ceiling
and a per-tenant **daily** breaker
(`LIVE_GATEWAY_TENANT_DAILY_INR_CAP`, default ₹2 000) which sheds new
consult starts as `busy`.

When tripped, the guard throws `CostCircuitOpenError`; the generate
route marks the draft `FAILED` with `errorMessage` set, and the
therapist sees the retry affordance on the session workspace.

## Immediate actions

1. Filter audit logs:
   `GET /api/v1/admin/audit-logs?action=COST_CIRCUIT_TRIPPED&from=<now-1h>`
2. The `metadata.scope` field distinguishes:
   - `session` — runaway prompt or retry storm on a single session.
   - `monthly` — tenant-level cap (suspect compromised credentials or
     adversarial usage).

## Session-scope diagnosis

1. Open the session in `gemini_call_logs`:
   ```
   SELECT pass, status, "costInr", "inputTokens", "outputTokens", "latencyMs"
   FROM gemini_call_logs
   WHERE "sessionId" = :sessionId
   ORDER BY "createdAt";
   ```
2. Most common cause: retry loop on a long transcript. Pass 1 (Flash)
   and Pass 2 (Pro) both retry once on transient Vertex errors; a long
   transcript multiplies cost per attempt.
3. Mitigation: bump the session cap via `COST_CAP_PER_SESSION_INR` on
   the Vercel env for the duration of recovery (env changes need a
   redeploy), then re-run generation from the session workspace.

## Monthly-scope diagnosis

1. Aggregate cost by psychologist (note: session-attributed rows join
   through `sessions`; the assistant-chat rows carry `psychologistId`
   directly):
   ```
   SELECT COALESCE(s."psychologistId", g."psychologistId") AS tenant,
          SUM(g."costInr") AS spent
   FROM gemini_call_logs g
   LEFT JOIN sessions s ON g."sessionId" = s.id
   WHERE g."createdAt" >= date_trunc('month', NOW())
   GROUP BY 1
   ORDER BY spent DESC;
   ```
2. If a single tenant dominates: contact the therapist, confirm the
   activity is legitimate (e.g. unusually long sessions), and decide
   whether to raise their cap.
3. If multiple tenants: suspect a leaked Vertex AI service-account
   key. Rotate via the GCP console and re-issue.

## Mitigating / clearing the trip

The circuit doesn't auto-reset — it always re-evaluates against the
cap. Raise the cap (env + redeploy), ack the alert, and the next
request flows. The gateway's daily breaker resets at IST midnight.

## Related

- `apps/web/lib/cost-guard.ts` (+ `services/live-gateway/src/tenant-spend.ts`)
- `AuditAction.COST_CIRCUIT_TRIPPED`
- CLAUDE.md § 3b (gateway metering).
