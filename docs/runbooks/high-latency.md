# High request latency (p95 > 1.5 s)

**Severity:** ticket. **SLA:** next business day.

## What this means

p95 HTTP duration on at least one service has sat above 1.5 seconds
for 10 minutes. The platform is up but degraded — users notice the
slowness even if requests eventually succeed.

## Diagnosis

1. Grafana: dashboard "Cureocity Mind — overview" → "Gemini call
   duration p95" panel. If Pass 1 or Pass 2 is the bottleneck, fix
   there.
2. Slow queries: run `pg_stat_statements` filtered to the past hour
   ordered by `total_time DESC` (top 10).
3. BullMQ backlog: `redis-cli LLEN bull:note-generation:wait`. A
   queue depth > 100 means the worker is the bottleneck.

## Common root causes

| Cause                       | Mitigation                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Vertex regional degradation | Failover to secondary region in `packages/llm`.                                              |
| Postgres lock contention    | `SELECT * FROM pg_stat_activity WHERE state='waiting'`.                                      |
| Audit-log write contention  | Audit-log table is append-only — verify the index is on `(targetType, targetId, createdAt)`. |
| BullMQ worker starved       | Scale up the scribe-service replicas; the worker is in-process.                              |
| N+1 in briefing dossier     | Profile via OTel traces (Honeycomb / Tempo).                                                 |

## Verification after fix

p95 drops below 1.5s in Grafana over a 10-min window.

## Related

- `services/scribe-service/src/notes/note-generation.processor.ts`
- `packages/llm/src/model-router.ts`
