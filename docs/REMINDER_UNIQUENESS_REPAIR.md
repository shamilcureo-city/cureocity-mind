# Reminder duplicate-prevention repair

## Outcome and scope

The fix-forward migration `20260926000600_reminder_delivery_uniqueness` restores database uniqueness for one appointment, scheduled start, reminder kind and recipient. Practitioner and patient reminders remain distinct, as do 24-hour/2-hour reminders and rescheduled appointments.

The old migrations are unchanged. Their long index names share the same first 63 bytes: PostgreSQL skipped the replacement index and then dropped the old one. The application relies on `createMany({ skipDuplicates: true })`; without database uniqueness, this does not prevent duplicate logical deliveries.

The repair uses the short index name `appointment_reminder_delivery_identity_key`. Prisma uses `map:` so the existing compound-selector API does not change. No provider integration, notification content or delivery state machine changes.

The existing `pnpm db:check-migrations` command also rejects index names over 63 UTF-8 bytes in new migrations dated on/after `20260926000600`. It checks top-level literal declarations and DO bodies; function bodies and dynamic SQL still require review. Applied historical files are grandfathered, not rewritten.

## Safety behavior

- One transaction holds a `SHARE` table lock from duplicate inspection through index verification and commit. Reads remain available; writers cannot insert a duplicate between inspection and installation.
- Lock acquisition is bounded at five seconds, and each statement at sixty seconds. Busy/large databases may need a separately approved maintenance window; a timeout is a failed migration, not proof of repair.
- All four identity columns must be non-null. Any duplicate identity stops the migration with an aggregate-free, identifier-free error. It does not delete, merge, cancel or mark any delivery as sent.
- An existing canonical name is accepted only if it is a valid, ready, live, immediate unique btree index on exactly the four expected columns, without expressions, predicates or included columns. A conflicting object stops the repair; it is never silently replaced.
- A successfully installed index is safe to replay. Historical migration checksums are unchanged.

## Authorized release procedure — not executed against production

1. Obtain explicit approval for the target environment, reminder-writer pause, migration-bearing release and rollback plan. Confirm the actual database/schema and pending migration chain. The normal Vercel release script may run `prisma migrate deploy`; deploying the web application is therefore a database-change boundary.
2. Pause reminder dispatch/enqueue using the environment's verified controls, and let in-flight workers settle. This document does not invent a pause switch or authorize scheduler/configuration changes. Keep dispatch paused if the migration chain or repair fails.
3. Run `scripts/check-reminder-delivery-uniqueness.sql` with an authorized read-only connection and the same search path as Prisma. Its output contains only duplicate counts and index metadata, not appointment IDs, email addresses or message contents. A zero count is a point-in-time preflight, not a concurrency guarantee.
4. If duplicates exist, stop for authorized reconciliation. Preserve all rows and provider/submission history. `SUBMISSION_STARTED`, `UNKNOWN`, `DELIVERED` and legacy `IN_FLIGHT` rows require particular care: do not infer that no message was sent or reset them for automatic retry. This change includes no automatic reconciliation policy or data mutation script.
5. Apply the reviewed pending migration chain only after approval. The historical recipient-copy migration can itself introduce duplicates when replayed without the missing uniqueness guard. Its deterministic copy ID and `ON CONFLICT DO NOTHING` do not prove logical uniqueness. The new migration checks the resulting table under its lock and fails closed if necessary. Do not replay old migrations as a repair.
6. Repeat the aggregate preflight after the full chain. Require zero duplicate groups, the canonical index present on the correct table, unique/valid/ready/live/immediate true, btree access, four keys/attributes in the expected order, no predicate/expression, and non-null identity columns. Verify the migration recorded success before resuming writers.
7. Resume only after those checks and any authorized reconciliation are complete. Run a separately approved fictional-appointment delivery check if desired. Local database tests never call a notification provider and cannot prove production delivery behavior.

If a migration fails, PostgreSQL rolls back this migration's own transaction and retains history. Earlier successfully committed migrations in the chain are not rolled back. The Vercel P3009 retry mechanism cannot reconcile duplicates or fix a conflicting index definition; repeated deployment attempts are not a data-repair strategy. Marking a failed migration rolled back or changing records/objects requires a reviewed, separately authorized recovery after diagnosing the cause.

## Rollback

An application rollback should retain the additive unique index. Old and new application code expect the same logical reminder identity; the short database name does not change Prisma's selector. Do not drop the index to roll back a UI release. If installation fails, leave reminder dispatch paused and resolve the reported data/schema/lock issue before retrying; do not remove history to make a build green.

## Local verification and limits

The opt-in real-database suite is `apps/web/lib/appointment-reminder-uniqueness-postgres.spec.ts`. It requires `RUN_MIND_POSTGRES_TESTS=1` and an explicit `MIND_TEST_DATABASE_URL` targeting only `127.0.0.1:55439/cureocity_mind_test`. It refuses alternate hosts, ports, databases and caller-supplied URL overrides and never uses application database credentials.

Tests use isolated fixture schemas, real PostgreSQL transactions/locks and the generated Prisma client. They cover historical truncation, corrected index creation/replay, duplicate-history preservation, wrong-index rejection, distinct logical identities, concurrent enqueue and observed writer-lock races. Fixture rows are fictional and retained for inspection; no notifications are sent.

Local verification is not evidence of production database state, provider delivery, authenticated browser flows or real microphone/gateway behavior. Commit, push, merge, deployment, production migration and any history reconciliation remain separate steps requiring authorization.

Verified locally on 10 September: actual Prisma migration deploy and SQL replay passed on disposable PostgreSQL 16.14; the aggregate preflight reported zero duplicate groups and the expected index. The web suite passed 193 files / 1,568 tests, including all 27 new reminder tests (15 real-database cases and 12 target guards). The migration-check command passed all 21 tests and repository checks. Typecheck, lint, schema validation/client generation, formatting and whitespace checks passed. The temporary database was stopped afterward and fictional fixtures retained. No production connection or notification-provider call was made.
