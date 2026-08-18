# Database owner and runtime roles

Production uses separate PostgreSQL identities for schema migration and application traffic.
This is an operational prerequisite, not an application-created credential.

## One-time privileged provisioning

Run this as the Neon/project administrator and choose the same identifier used below. Supply
the password through the provider secret UI; never commit it.

```sql
CREATE ROLE cureocity_runtime LOGIN PASSWORD '<provider-managed-secret>';
GRANT CONNECT ON DATABASE cureocity TO cureocity_runtime;
-- Do not grant table ownership or CREATE on schema public. The deploy setup
-- grants CRUD on application tables and sequence use after migrations.
```

The migration connection must remain a distinct owner-capable role. A PostgreSQL table owner
can alter/disable triggers and re-grant privileges, so the append-only trigger is defense in
depth, not a substitute for role separation.

## Production environment

Configure all three as deployment secrets:

- `DATABASE_URL_UNPOOLED`: direct migration-owner URL, used only by Prisma migration/setup.
- `DATABASE_RUNTIME_URL`: pooled URL whose username is the least-privilege runtime role.
- `DATABASE_RUNTIME_ROLE`: validated role identifier (for example `cureocity_runtime`).

`apps/web/lib/prisma.ts` refuses a Production runtime without `DATABASE_RUNTIME_URL` and rejects
an owner/runtime username match when both URLs are parseable. Vercel Preview remains compatible
with its branch `DATABASE_URL` despite Next setting `NODE_ENV=production`. The deploy setup fails
closed on missing runtime variables only when `VERCEL_ENV=production` (or when the script is run
outside Vercel without an explicit preview environment).

## Every deployment

After `prisma migrate deploy`, the deployment runs:

```bash
node scripts/configure-runtime-db-role.mjs
```

The script uses the migration-owner connection, validates `DATABASE_RUNTIME_ROLE`, verifies
the role already exists, and grants schema usage, CRUD on all existing application tables,
sequence use, plus matching default privileges for tables created by later migrations. It then
verifies `note_signature_versions` is still owned by the current migration role, revokes all
runtime privileges on that table, grants only `SELECT, INSERT`, and explicitly revokes execution
of `redact_client_signed_note_phi`. The lawful DPDP fulfilment route invokes that narrowly scoped
owner-controlled function with `DATABASE_URL_UNPOOLED`; runtime and `PUBLIC` cannot execute it or
update signature history directly. Re-running the script is idempotent. It embeds and logs no URL
or credential. The migration separately revokes function execution and destructive table access
from `PUBLIC`.

After applying grants, deployment connects through `DATABASE_RUNTIME_URL` and verifies the live
identity (`current_user` and `current_database()`). It fails closed if the role is superuser,
`BYPASSRLS`, can create roles/databases, replicates, belongs to a table-owner role, inherits
destructive access to signature history, or has `CREATE` on `public`. The query uses
`pg_has_role`, `has_table_privilege`, `has_function_privilege`, and `has_schema_privilege`;
connection strings are never printed.

A missing role, owner drift, role/URL mismatch, or privilege-setup failure blocks deployment.
Do not point application runtime traffic at `DATABASE_URL_UNPOOLED`.
