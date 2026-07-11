# High request latency (p95 > 1.5 s)

**Severity:** ticket. **SLA:** next business day.

## What this means

p95 HTTP duration has sat above 1.5 seconds for 10 minutes. The
platform is up but degraded — users notice the slowness even if
requests eventually succeed.

## Diagnosis

1. Vercel → Project → Observability: which routes are slow, and is it
   compute or upstream wait? (Sentry performance traces, once
   `SENTRY_DSN` is set, break this down per-span.)
2. Gemini: `SELECT pass, AVG("latencyMs"), MAX("latencyMs") FROM
gemini_call_logs WHERE "createdAt" > NOW() - interval '1 hour'
GROUP BY pass;` — if Pass 1/2 dominates, this is Vertex latency,
   not app latency (see gemini-timeouts.md).
3. Slow queries: Neon console → Monitoring → Query performance (or
   `pg_stat_statements` ordered by `total_time DESC`, top 10).
4. Cold starts: a spike of first-request latencies after a deploy is
   Vercel serverless cold start + Prisma engine init — expected to
   settle within minutes.
5. Live consults: latency there is the gateway's, not Vercel's —
   check `https://gateway.cureo.city/healthz` and Cloud Run metrics
   (CPU throttling, instance count).

## Common root causes

| Cause                       | Mitigation                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Vertex regional degradation | Wait out / support ticket; retries + timeouts already bound each attempt (gemini-timeouts.md). |
| Postgres lock contention    | `SELECT * FROM pg_stat_activity WHERE wait_event IS NOT NULL;`                                 |
| Missing index on a hot path | Neon query insights → add the index via a guarded migration.                                   |
| PgBouncer pool exhaustion   | Check Neon pooler stats; the app must keep using the POOLED `DATABASE_URL`.                    |
| N+1 in a dossier/journey    | The client briefing + journey composers batch their reads — profile before adding queries.     |

## Verification after fix

p95 drops below 1.5 s over a 10-minute window (Vercel Observability /
Sentry).

## Related

- `apps/web/lib/prisma.ts` (pooled vs unpooled connection choice)
- `packages/llm/src/model-router.ts`
- docs/runbooks/gemini-timeouts.md
