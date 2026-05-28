# Audit writes stalled

**Severity:** ticket. **SLA:** same business day. Treat as
**compliance-critical** — DPDP § 16 requires an audit trail of every
processing operation.

## What this means

HTTP traffic is flowing but no `audit_writes_total` increments are
arriving in Prometheus for 5 minutes. Either:

1. The DB write path is broken (Prisma errors, lock contention, FK
   failure), or
2. Audit instrumentation has regressed — somebody added a write
   endpoint without an `audit.log` call.

The first is operational. The second is a code review failure that
the Sprint 9 PR 4 chaos test should have caught — verify whether the
chaos test still passes on the failing commit (`pnpm -F
@cureocity/contracts test -- audit-coverage`).

## Diagnosis

### Hypothesis 1: DB write failures

1. Tail any service's logs for `PrismaClientKnownRequestError` or
   `Failed to log audit event`.
2. Sample the audit_logs table directly:
   ```
   SELECT COUNT(*), MAX(created_at) FROM audit_logs;
   ```
   If `MAX(created_at)` is more than 5 minutes ago, the write path
   is definitely broken.
3. Check Postgres for full disk / WAL pressure:
   ```
   SELECT pg_size_pretty(pg_database_size('cureocity_mind'));
   SELECT name, setting FROM pg_settings WHERE name IN ('max_wal_size','min_wal_size');
   ```

### Hypothesis 2: Instrumentation regression

1. Re-run the chaos audit test:
   `pnpm -F @cureocity/contracts test -- audit-coverage`
2. If it fails, the offending action name is in the test output. Find
   the offending endpoint, add the `audit.log` call.
3. If it passes but Prometheus shows zero writes, the OTel meter is
   broken — usually OTEL_DISABLED=true got set in production by
   mistake. Check the service's env config.

## Recovery

| Hypothesis            | Action                                            |
| --------------------- | ------------------------------------------------- |
| DB lock contention    | `pg_terminate_backend(pid)` for the offending tx. |
| WAL / disk pressure   | Increase volume; vacuum aggressively.             |
| Missing audit call    | Hot-patch the endpoint + redeploy; backfill audit |
|                       | rows from server logs for the missing window.     |
| OTEL_DISABLED in prod | Flip the env var, rolling restart.                |

## Compliance backfill

If the gap is real and only known to operations (not visible in the
audit log), file an incident ticket noting the time window and the
affected endpoint set. Sprint 11+ adds a structured backfill tool;
until then a SQL-level reconstruction from `prisma migration_lock`,
service logs, and HTTP access logs is the manual procedure.

## Related

- `packages/contracts/src/audit-coverage.spec.ts`
- `services/*/src/audit/audit.service.ts`
- DPDP § 16 — "maintain proper records"
