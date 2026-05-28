# Disaster recovery — Postgres restore

**Severity:** invoked manually during DR. **Owner:** platform on-call.

## Targets (gap G12)

- **RPO** (recovery point objective) ≤ **15 minutes.**
- **RTO** (recovery time objective) ≤ **1 hour.**

The 15-minute RPO is achieved via continuous WAL archival to S3
(`cureocity-mind-pg-wal` bucket, ap-south-1) plus daily base backups.
RTO is bounded by network speed pulling the most recent base backup

- WAL replay; tested by the Sprint 10 PR 3 DR script.

## Pre-flight (every restore)

1. **Stop traffic to the failed primary.** In Kubernetes:
   ```
   kubectl -n cureocity scale deploy --replicas=0 \
     patient-model-service scribe-service modality-workflow-service \
     affect-engine-service continuity-service pdf-generator-service
   ```
   In docker-compose dev:
   ```
   docker compose -f infrastructure/docker-compose.yml stop \
     postgres
   ```
2. **Snapshot the broken primary's WAL position** (if reachable):
   ```
   pg_controldata $PGDATA | grep "Latest checkpoint location"
   ```
   File this in the incident ticket.

## Restore from base backup + WAL

Real production runbook (KMS-encrypted backups in S3):

```bash
# 1. Identify the latest base backup
aws s3 ls s3://cureocity-mind-pg-wal/base/ --recursive | sort | tail -1

# 2. Restore to a clean data directory
mkdir -p /var/lib/postgresql/restore && cd /var/lib/postgresql/restore
aws s3 cp s3://cureocity-mind-pg-wal/base/<latest>.tar.gz - | tar xzf -

# 3. Drop in a recovery.signal + restore_command in postgresql.conf
cat > postgresql.conf.append <<EOF
restore_command = 'aws s3 cp s3://cureocity-mind-pg-wal/wal/%f %p'
recovery_target_time = '<incident-timestamp - 1 minute>'
recovery_target_action = 'promote'
EOF
cat postgresql.conf.append >> postgresql.conf
touch recovery.signal

# 4. Start Postgres pointed at the restore directory
pg_ctl -D /var/lib/postgresql/restore -l restore.log start

# 5. Tail the log until "consistent recovery state reached" then
#    "selected new timeline ID" — recovery is complete.
tail -f restore.log
```

## Verify before re-opening traffic

1. Check the latest audit row:
   ```
   SELECT MAX(created_at) FROM audit_logs;
   ```
   If the value is more than 15 minutes before the incident time,
   the RPO has been breached — file a P0.
2. Spot-check a recent therapy note:
   ```
   SELECT id, signed_at FROM therapy_notes ORDER BY signed_at DESC LIMIT 1;
   ```
3. Run the chaos audit test against the recovered DB to confirm
   structural integrity.

## Re-opening traffic

1. Update the connection string in service configs (or repoint via
   DNS / PgBouncer if that abstraction is in place).
2. Scale services back up gradually — start at 1 replica, watch p95
   latency for 5 minutes, then scale to target.
3. Announce in the operations Slack channel with timeline + RPO
   achieved.

## DR drill expectations

- **Quarterly drill** (Sprint 10 ships the first one): execute this
  runbook against the staging cluster, time each step, file the
  result in `docs/runbooks/dr-log.md`.
- Drill failure (didn't meet RTO ≤ 1 hour) blocks the pilot
  go-live.

## Related

- Backup strategy: pgBackRest / wal-g — choice TBD with infra lead.
- Sprint 10 PR 3 — DR script `scripts/dr-test.ts`.
- DPDP § 8(7) — backups are a Fiduciary duty.
