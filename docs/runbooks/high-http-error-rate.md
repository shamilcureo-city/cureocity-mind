# High HTTP error rate

**Severity:** page. **SLA:** acknowledge in 15 min.

## What this means

5xx response rate exceeded 5% of total requests over a sustained
5-minute window. Either a hot path is crashing or an upstream
dependency (Neon Postgres, Vertex, Firebase, WATI/SendGrid) is failing
the requests that depend on it.

## Immediate triage

1. Identify the surface:
   - Vercel → Project → Observability → errors by route (or Sentry
     issues, once `SENTRY_DSN` is set).
   - Live consult errors are the gateway's — check
     `https://gateway.cureo.city/healthz` + Cloud Run logs instead.
2. Tail the logs: Vercel → Deployments → Runtime Logs (filter 5xx).
3. Identify the error class:
   - `PrismaClientKnownRequestError` / pool timeouts → DB problem.
   - `5xx` from Vertex / WATI / Twilio → upstream provider.
   - `[auth-page]` / `[auth-server]` log lines → see
     `docs/AUTH_SESSION.md` (bounced-to-login table).

## Recovery decision tree

| Symptom                               | Action                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| Single hot path 100% failure          | Instant Rollback in the Vercel dashboard to the last good deploy. |
| DB-bound errors (timeouts, deadlocks) | Check Neon status/health; see `dr-postgres-restore.md`.           |
| Vertex 5xx                            | Bounded retries already absorb blips; see `gemini-timeouts.md`.   |
| Gateway 5xx / WS failures             | Cloud Run revision rollback; browser degrades to record-only.     |
| Errors only from one client / tenant  | Suspect bad input; capture a request body + escalate.             |

## Verification after fix

1. 5xx rate drops below 1% within 5 min (Vercel Observability).
2. Run the chaos-audit test locally to confirm no audit-write
   regression: `pnpm -F @cureocity/contracts test -- audit-coverage`.

## Related

- `docs/AUTH_SESSION.md` — the auth-specific 5xx/redirect table
- `dr-postgres-restore.md` for the DB-failure branch
