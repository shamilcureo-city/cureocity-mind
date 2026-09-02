import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const prismaRoot = join(import.meta.dirname, '../../../prisma');
const homeworkMigrationPath = join(
  prismaRoot,
  'migrations/20260922000000_explicit_homework/migration.sql',
);
const tenantMigrationPath = join(
  prismaRoot,
  'migrations/20260924000000_assignment_provenance_tenant_integrity/migration.sql',
);

function migrationSql(): string {
  return existsSync(tenantMigrationPath) ? readFileSync(tenantMigrationPath, 'utf8') : '';
}

describe('R2-05 assignment provenance database integrity migration', () => {
  it('enforces same-client and same-psychologist provenance on direct INSERT and UPDATE', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "enforce_exercise_assignment_provenance_tenant"',
    );
    expect(sql).toMatch(
      /NEW\."sourceSessionId" IS NOT NULL[\s\S]+FROM "sessions" AS source[\s\S]+source\."id" = NEW\."sourceSessionId"[\s\S]+source\."clientId" = NEW\."clientId"[\s\S]+source\."psychologistId" = NEW\."psychologistId"/,
    );
    expect(sql).toMatch(
      /NEW\."responseShareId" IS NOT NULL[\s\S]+FROM "patient_shares" AS share[\s\S]+share\."id" = NEW\."responseShareId"[\s\S]+share\."clientId" = NEW\."clientId"[\s\S]+share\."psychologistId" = NEW\."psychologistId"/,
    );
    expect(sql).toContain("ERRCODE = '23514'");
    expect(sql).toMatch(
      /CREATE CONSTRAINT TRIGGER "exercise_assignments_provenance_tenant_trigger"[\s\S]+AFTER INSERT OR UPDATE OF "sourceSessionId", "responseShareId", "clientId", "psychologistId"/,
    );
    expect(sql).toContain('EXECUTE FUNCTION "enforce_exercise_assignment_provenance_tenant"()');
    expect(sql).toMatch(
      /CREATE CONSTRAINT TRIGGER "sessions_assignment_provenance_tenant_trigger"[\s\S]+AFTER UPDATE OF "id", "clientId", "psychologistId"[\s\S]+EXECUTE FUNCTION "enforce_session_assignment_provenance_tenant"\(\)/,
    );
    expect(sql).toMatch(
      /CREATE CONSTRAINT TRIGGER "patient_shares_assignment_provenance_tenant_trigger"[\s\S]+AFTER UPDATE OF "id", "clientId", "psychologistId"[\s\S]+EXECUTE FUNCTION "enforce_patient_share_assignment_provenance_tenant"\(\)/,
    );
  });

  it('cleans legacy mismatches before enforcement while allowing valid references', () => {
    const sql = migrationSql();
    const triggerPosition = sql.indexOf(
      'CREATE CONSTRAINT TRIGGER "exercise_assignments_provenance_tenant_trigger"',
    );

    expect(sql).toMatch(
      /UPDATE "exercise_assignments" AS assignment\s+SET "sourceSessionId" = NULL[\s\S]+NOT EXISTS \([\s\S]+source\."id" = assignment\."sourceSessionId"[\s\S]+source\."clientId" = assignment\."clientId"[\s\S]+source\."psychologistId" = assignment\."psychologistId"/,
    );
    expect(sql).toMatch(
      /UPDATE "exercise_assignments" AS assignment\s+SET "responseShareId" = NULL[\s\S]+NOT EXISTS \([\s\S]+share\."id" = assignment\."responseShareId"[\s\S]+share\."clientId" = assignment\."clientId"[\s\S]+share\."psychologistId" = assignment\."psychologistId"/,
    );
    expect(triggerPosition).toBeGreaterThan(sql.indexOf('SET "sourceSessionId" = NULL'));
    expect(triggerPosition).toBeGreaterThan(sql.indexOf('SET "responseShareId" = NULL'));
    expect(sql).not.toMatch(/NEW\."sourceSessionId" IS NULL[\s\S]+RAISE EXCEPTION/);
    expect(sql).not.toMatch(/NEW\."responseShareId" IS NULL[\s\S]+RAISE EXCEPTION/);
  });

  it('is replay-safe and scopes catalog existence checks to this schema and relation', () => {
    const sql = migrationSql();
    const homeworkSql = readFileSync(homeworkMigrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION');
    expect(sql).toContain('FROM pg_trigger AS catalog_trigger');
    expect(sql).toContain('JOIN pg_class AS relation ON relation.oid = catalog_trigger.tgrelid');
    expect(sql).toContain('JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace');
    expect(sql).toContain("catalog_trigger.tgrelid = 'exercise_assignments'::regclass");
    expect(sql).toContain('schema.nspname = current_schema()');
    expect(sql).toContain('IF NOT EXISTS');

    for (const constraintName of [
      'exercise_assignments_sourceSessionId_fkey',
      'exercise_assignments_responseShareId_fkey',
    ]) {
      const constraintCheck = new RegExp(
        `conname = '${constraintName}'[\\s\\S]{0,220}conrelid = 'exercise_assignments'::regclass[\\s\\S]{0,220}schema\\.nspname = current_schema\\(\\)`,
      );
      expect(homeworkSql).toMatch(constraintCheck);
    }
  });

  it('retains assignment rows and nulls only the deleted provenance pointer', () => {
    const schema = readFileSync(join(prismaRoot, 'schema.prisma'), 'utf8');
    const homeworkSql = readFileSync(homeworkMigrationPath, 'utf8');

    expect(homeworkSql).toMatch(
      /FOREIGN KEY \("sourceSessionId"\) REFERENCES "sessions"\("id"\)\s+ON DELETE SET NULL ON UPDATE CASCADE/,
    );
    expect(homeworkSql).toMatch(
      /FOREIGN KEY \("responseShareId"\) REFERENCES "patient_shares"\("id"\)\s+ON DELETE SET NULL ON UPDATE CASCADE/,
    );
    expect(schema).toMatch(
      /sourceSession\s+Session\?\s+@relation\("ExerciseAssignmentSourceSession"[^\n]+onDelete: SetNull\)/,
    );
    expect(schema).toMatch(
      /responseShare\s+PatientShare\?\s+@relation\("ExerciseAssignmentResponseShare"[^\n]+onDelete: SetNull\)/,
    );
  });
});
