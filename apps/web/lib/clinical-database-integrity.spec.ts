import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(process.cwd(), '../..');
const source = (path: string) => readFileSync(resolve(repo, path), 'utf8');

function typescriptFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    if (['node_modules', '.git', '.next', 'dist', 'coverage'].includes(entry)) continue;
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...typescriptFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.spec\./.test(entry)) result.push(path);
  }
  return result;
}

describe('therapy-note database integrity boundary', () => {
  const migrationPath =
    'prisma/migrations/20260913000000_signed_note_integrity_runtime_role/migration.sql';

  it('rejects direct TherapyNote.content updates without an explicit signing or erasure transaction context', () => {
    const migration = source(migrationPath);
    expect(migration).toContain('BEFORE UPDATE OF "content" ON "therapy_notes"');
    expect(migration).toContain("current_setting('app.therapy_note_write_context', true)");
    expect(migration).toContain("NOT IN ('signing', 'erasure')");
  });

  it('allows the only audited content writers to set a transaction-local context', () => {
    const sign = source('apps/web/app/api/v1/sessions/[id]/sign/route.ts');
    const erasure = source(
      'prisma/migrations/20260914000000_dpdp_signed_note_erasure/migration.sql',
    );
    expect(sign).toContain("set_config('app.therapy_note_write_context', 'signing', true)");
    expect(erasure).toContain("set_config('app.therapy_note_write_context', 'erasure', true)");
    expect(source('apps/web/app/api/v1/sessions/[id]/note/edit/route.ts')).not.toMatch(
      /therapyNote\.(update|updateMany|upsert)\s*\(/,
    );
  });

  it('has no unclassified TherapyNote update writer', () => {
    const roots = [resolve(repo, 'apps'), resolve(repo, 'services')];
    const writers = roots
      .flatMap(typescriptFiles)
      .filter((path) =>
        /therapyNote\.(update|updateMany|upsert)\s*\(/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(repo, path).replace(/\\/g, '/'))
      .sort();
    expect(writers).toEqual([
      'apps/web/app/api/v1/sessions/[id]/note/unlock/route.ts',
      'apps/web/app/api/v1/sessions/[id]/sign/route.ts',
    ]);
    const unlock = source('apps/web/app/api/v1/sessions/[id]/note/unlock/route.ts');
    const unlockMutation = unlock.match(/therapyNote\.update\(\{[\s\S]*?\n\s*\}\);/)?.[0];
    expect(unlockMutation).toBeDefined();
    expect(unlockMutation).not.toMatch(/\bcontent\s*:/);
  });
});

describe('DPDP erasure decision integrity', () => {
  it('locks request and client, then conditionally transitions the expected status', () => {
    const route = source('apps/web/app/api/v1/admin/erasure/[id]/route.ts');
    expect(route).toContain('FROM "client_erasure_requests"');
    expect(route).toContain('FOR UPDATE OF r, c');
    expect(route).toContain('clientErasureRequest.updateMany');
    expect(route).toContain('status: locked.status');
    expect(route).toContain('Erasure decision changed concurrently');
  });

  it('uses the scoped owner function and hashes resolution notes in audits', () => {
    const route = source('apps/web/app/api/v1/admin/erasure/[id]/route.ts');
    const erasure = source('apps/web/lib/dpdp-erasure.ts');
    expect(erasure).toContain('redact_client_signed_note_phi');
    expect(route).toContain("import { getMigrationPrisma } from '@/lib/prisma-migration'");
    expect(route).toContain('getMigrationPrisma().$transaction');
    expect(route).toContain('resolutionNotesHashHex');
    expect(route).not.toMatch(
      /metadata:[\s\S]{0,500}resolutionNotes:\s*body\.value\.resolutionNotes/,
    );
  });

  it('never describes approval as fulfilment and emits fulfilment only beside erasure', () => {
    const route = source('apps/web/app/api/v1/admin/erasure/[id]/route.ts');
    expect(route).toContain("action: 'DSR_ERASURE_APPROVED'");
    expect(route).not.toMatch(/status === 'APPROVED'[\s\S]{0,120}DSR_ERASURE_FULFILLED/);
    expect(route).toMatch(
      /if \(body\.value\.status === 'FULFILLED'\) \{[\s\S]*eraseClientPhi[\s\S]*DSR_ERASURE_FULFILLED/,
    );
  });
});

describe('signed-note correction concurrency boundary', () => {
  it('locks Session, NoteDraft and TherapyNote in order and rejects stale draft state', () => {
    const route = source('apps/web/app/api/v1/sessions/[id]/note/edit/route.ts');
    const session = route.indexOf('FROM "sessions"');
    const draft = route.indexOf('FROM "note_drafts"');
    const note = route.indexOf('FROM "therapy_notes"');
    expect(session).toBeGreaterThan(0);
    expect(draft).toBeGreaterThan(session);
    expect(note).toBeGreaterThan(draft);
    expect(route.match(/FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(3);
    expect(route).toContain('Draft changed concurrently; reload before editing');
    expect(route).toContain('canonicalJson(draft.content) !== canonicalJson(note.content)');
    expect(route).toContain('noteDraft.updateMany');
  });

  it('resolves medical correction shape from the locked practitioner vertical', () => {
    const route = source('apps/web/app/api/v1/sessions/[id]/note/edit/route.ts');
    expect(route).toContain('MedicalEncounterNoteV1Schema');
    expect(route).toContain('signableKindFor(session.kind as never, session.vertical as never)');
  });
});

describe('signature-history least privilege', () => {
  const migrationPath =
    'prisma/migrations/20260913000000_signed_note_integrity_runtime_role/migration.sql';

  it('revokes destructive privileges from PUBLIC and grants runtime only SELECT and INSERT', () => {
    const migration = source(migrationPath);
    expect(migration).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "note_signature_versions" FROM PUBLIC',
    );
    const setup = source('scripts/configure-runtime-db-role.mjs');
    expect(setup).toContain('REVOKE ALL PRIVILEGES ON TABLE "note_signature_versions" FROM');
    expect(setup).toContain('GRANT SELECT, INSERT ON TABLE "note_signature_versions" TO');
    expect(setup).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE|TRUNCATE)[^;]*ON TABLE "note_signature_versions"/,
    );
    expect(setup).toContain('tableowner');
    expect(setup).toContain('must remain owned by the migration role');
  });

  it('grants coherent runtime access to all application tables, sequences, and future migrations', () => {
    const setup = source('scripts/configure-runtime-db-role.mjs');
    expect(setup).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public');
    expect(setup).toContain('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public');
    expect(setup).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public');
    expect(
      setup.indexOf('REVOKE ALL PRIVILEGES ON TABLE "note_signature_versions"'),
    ).toBeGreaterThan(
      setup.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public'),
    );
  });

  it('validates the runtime role identifier and contains no embedded URL or password', () => {
    const setup = source('scripts/configure-runtime-db-role.mjs');
    expect(setup).toContain('/^[A-Za-z_][A-Za-z0-9_]{0,62}$/');
    expect(setup).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(setup).not.toMatch(/password\s*=|secret\s*=/i);
  });

  it('documents the privileged provisioning prerequisite and owner limitation', () => {
    const runbook = source('docs/runbooks/database-roles.md');
    expect(runbook).toContain('DATABASE_RUNTIME_URL');
    expect(runbook).toContain('DATABASE_RUNTIME_ROLE');
    expect(runbook).toContain('CREATE ROLE');
    expect(runbook).toContain('table owner');
    expect(runbook).toContain('scripts/configure-runtime-db-role.mjs');
  });

  it('makes production deployment fail closed and applies privileges after migrations', () => {
    const deploy = source('scripts/vercel-db-setup.sh');
    expect(deploy).toContain('DATABASE_RUNTIME_URL');
    expect(deploy).toContain('DATABASE_RUNTIME_ROLE');
    expect(deploy).toContain('configure-runtime-db-role.mjs');
    expect(deploy.indexOf('configure-runtime-db-role.mjs')).toBeGreaterThan(
      deploy.lastIndexOf('prisma migrate deploy'),
    );
    expect(deploy).toContain('VERCEL_ENV');
    expect(deploy).toContain('verify-runtime-db-role.mjs');
  });

  it('provides an owner-only, transaction-scoped DPDP erasure path for every signed PHI field', () => {
    const migration = source(
      'prisma/migrations/20260914000000_dpdp_signed_note_erasure/migration.sql',
    );
    expect(migration).toContain('redact_client_signed_note_phi');
    expect(migration).toContain(
      "set_config('app.note_signature_erasure_context', 'lawful_erasure', true)",
    );
    expect(migration).toContain('UPDATE "therapy_notes"');
    expect(migration).toContain('"content" = \'{}\'::jsonb');
    expect(migration).toContain('"rxPad" = NULL');
    expect(migration).toContain('"signPayload" = NULL');
    expect(migration).toContain('UPDATE "note_signature_versions"');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT) FROM PUBLIC',
    );
    expect(migration).toContain('current_user = relation_owner');
    expect(migration).toContain('note_signature_versions is append-only');
  });

  it('verifies effective runtime identity and privileges through the runtime connection', () => {
    const setup = source('scripts/configure-runtime-db-role.mjs');
    const verify = source('scripts/verify-runtime-db-role.mjs');
    const deploy = source('scripts/vercel-db-setup.sh');
    expect(deploy).toContain('verify-runtime-db-role.mjs');
    expect(setup).toContain('REVOKE ALL ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT)');
    expect(setup).not.toContain(
      'GRANT EXECUTE ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT)',
    );
    expect(verify).toContain('DATABASE_RUNTIME_URL');
    expect(verify).toContain('current_user');
    expect(verify).toContain('current_database()');
    expect(verify).toContain('rolsuper');
    expect(verify).toContain('rolbypassrls');
    expect(verify).toContain('rolcreaterole');
    expect(verify).toContain('rolcreatedb');
    expect(verify).toContain('rolreplication');
    expect(verify).toContain('pg_has_role');
    expect(verify).toContain('has_table_privilege');
    expect(verify).toContain('has_function_privilege');
    expect(verify).toContain('has_schema_privilege');
    expect(verify).not.toMatch(/console\.(?:log|error)\([^)]*runtimeUrl/);
  });
});
