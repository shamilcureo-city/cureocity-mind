# High HTTP error rate

**Severity:** page. **SLA:** acknowledge in 15 min.

## What this means

5xx response rate on at least one service exceeded 5% of total
requests over a sustained 5-minute window. Either the service is
crashing on a hot path or an upstream dependency (Postgres, Redis,
Vertex, S3) is failing the requests it depends on.

## Immediate triage

1. Identify the service:
   - The alert's `service_name` label names which one.
   - In Grafana: `Cureocity Mind — overview` dashboard → "HTTP request
     rate by service" panel.
2. Tail the service logs (production: `kubectl logs -n cureocity ...`;
   dev: `pnpm -F <service> start:dev` output).
3. Identify the error class:
   - `PrismaClientKnownRequestError` → DB problem.
   - `5xx` from Vertex / WATI / Twilio → upstream provider.
   - `ECONNREFUSED` to Redis → BullMQ worker / cache outage.

## Recovery decision tree

| Symptom                               | Action                                                |
| ------------------------------------- | ----------------------------------------------------- |
| Single hot path 100% failure          | Roll back the most recent service deploy.             |
| DB-bound errors (timeouts, deadlocks) | Check Postgres health; see `dr-postgres-restore.md`.  |
| Redis-bound errors                    | Failover Redis primary; BullMQ retries cover gap.     |
| Vertex 5xx                            | Failover to Pass 2 router's secondary region.         |
| Errors only from one client / tenant  | Suspect bad input; capture a request body + escalate. |

## Verification after fix

1. 5xx rate drops below 1% in Grafana within 5 min.
2. Run the chaos-audit test locally to confirm no audit-write
   regression: `pnpm -F @cureocity/contracts test -- audit-coverage`.

## Related

- `infrastructure/prometheus/alerts/cureocity-alerts.yml`
- `dr-postgres-restore.md` for the DB-failure branch
