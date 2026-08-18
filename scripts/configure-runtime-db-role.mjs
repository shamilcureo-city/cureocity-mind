#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const role = process.env.DATABASE_RUNTIME_ROLE;
const runtimeUrl = process.env.DATABASE_RUNTIME_URL;
if (!role || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(role)) {
  throw new Error(
    'DATABASE_RUNTIME_ROLE is required and must be a valid unquoted PostgreSQL role identifier',
  );
}
if (!runtimeUrl) throw new Error('DATABASE_RUNTIME_URL is required');

let runtimeUsername;
try {
  runtimeUsername = decodeURIComponent(new URL(runtimeUrl).username);
} catch {
  throw new Error('DATABASE_RUNTIME_URL must be a valid PostgreSQL connection URL');
}
if (runtimeUsername !== role) {
  throw new Error('DATABASE_RUNTIME_ROLE must match the username in DATABASE_RUNTIME_URL');
}

// role is regex-constrained above. SQL still uses format(%I) for identifier quoting.
const sql = `
DO $runtime_role$
DECLARE
  configured_role CONSTANT text := '${role}';
  table_owner text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = configured_role) THEN
    RAISE EXCEPTION 'runtime database role % does not exist; create it out-of-band without embedding credentials', configured_role;
  END IF;

  SELECT tableowner INTO table_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'note_signature_versions';

  IF table_owner IS NULL THEN
    RAISE EXCEPTION 'note_signature_versions does not exist; run migrations first';
  END IF;
  IF table_owner <> current_user THEN
    RAISE EXCEPTION 'note_signature_versions must remain owned by the migration role (current migration role %, owner %)', current_user, table_owner;
  END IF;
  IF table_owner = configured_role THEN
    RAISE EXCEPTION 'runtime role must not own note_signature_versions';
  END IF;

  -- Existing application objects and objects created by later migrations need
  -- coherent least-privilege access. The immutable signature-history table is
  -- narrowed again below after the broad application grant.
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', configured_role);
  EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', configured_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', configured_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', configured_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', configured_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', configured_role);

  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "note_signature_versions" FROM %I', configured_role);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE "note_signature_versions" TO %I', configured_role);
  EXECUTE format('REVOKE ALL ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT) FROM %I', configured_role);
END
$runtime_role$;
`;

const result = spawnSync(
  'pnpm',
  ['exec', 'prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'],
  { input: sql, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'], env: process.env },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Runtime database role privileges applied.');
