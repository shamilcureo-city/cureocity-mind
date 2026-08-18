#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

export function assertRuntimeRoleVerification(row, expectedRole, expectedDatabase) {
  if (!row || row.current_user !== expectedRole || row.current_database !== expectedDatabase) {
    throw new Error('Runtime database connection identity does not match configured role/database');
  }
  const forbidden = ['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb', 'rolreplication'];
  if (forbidden.some((flag) => row[flag] === true)) {
    throw new Error('Runtime database role has forbidden PostgreSQL role attributes');
  }
  if (
    row.owner_membership ||
    row.signature_update ||
    row.signature_delete ||
    row.signature_truncate ||
    row.erasure_execute
  ) {
    throw new Error(
      'Runtime database role inherits owner or destructive signature-history privileges',
    );
  }
  if (row.schema_create)
    throw new Error('Runtime database role must not have CREATE on schema public');
}

export async function verifyRuntimeDatabaseRole(env = process.env) {
  const runtimeUrl = env.DATABASE_RUNTIME_URL;
  const expectedRole = env.DATABASE_RUNTIME_ROLE;
  if (!runtimeUrl || !expectedRole) {
    throw new Error('DATABASE_RUNTIME_URL and DATABASE_RUNTIME_ROLE are required');
  }
  const parsed = new URL(runtimeUrl);
  const expectedDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('?')[0]);
  const client = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  try {
    const rows = await client.$queryRawUnsafe(`
      SELECT current_user,
             current_database() AS current_database,
             r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
             EXISTS (
               SELECT 1 FROM pg_class c
               WHERE c.relname = 'note_signature_versions'
                 AND pg_has_role(current_user, pg_get_userbyid(c.relowner), 'MEMBER')
             ) AS owner_membership,
             has_table_privilege(current_user, 'public.note_signature_versions', 'UPDATE') AS signature_update,
             has_table_privilege(current_user, 'public.note_signature_versions', 'DELETE') AS signature_delete,
             has_table_privilege(current_user, 'public.note_signature_versions', 'TRUNCATE') AS signature_truncate,
             has_function_privilege(current_user, 'public.redact_client_signed_note_phi(text,text)', 'EXECUTE') AS erasure_execute,
             has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
      FROM pg_roles r WHERE r.rolname = current_user
    `);
    assertRuntimeRoleVerification(rows[0], expectedRole, expectedDatabase);
  } finally {
    await client.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await verifyRuntimeDatabaseRole();
  console.log('Runtime database role effective privileges verified.');
}
