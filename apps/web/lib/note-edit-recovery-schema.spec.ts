import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DPDP_ERASURE_MANIFEST } from './dpdp-erasure-manifest';
import { analyzeRegulatedRouteSource } from './regulated-route-discovery';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
describe('manual-edit recovery schema, privacy and role integration', () => {
  it('has one encrypted payload with independent versions and a cascading Session parent', () => {
    const schema = source('../../prisma/schema.prisma');
    const model = schema.match(/model NoteEditRecovery \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const fields = model
      .split('\n')
      .map((line) => line.trim().match(/^(\w+)\s+([\w]+)(?:\[\]|\?)?/))
      .filter((match) => match !== null)
      .map((match) => match![1]);
    expect(fields).toEqual([
      'sessionId',
      'encryptedFields',
      'revision',
      'baseDraftUpdatedAt',
      'kind',
      'lastMutationId',
      'lastMutationRevision',
      'lastMutationOperation',
      'createdAt',
      'updatedAt',
      'session',
    ]);
    expect(model).toMatch(/encryptedFields\s+String\?\s+@db\.Text/);
    expect(model).toMatch(/sessionId\s+String\s+@id/);
    expect(model).toContain('onDelete: Cascade');
    expect(model).toContain('@@map("note_edit_recoveries")');
    expect(schema).toMatch(/noteEditRecovery\s+NoteEditRecovery\?/);
  });
  it('adds only a replay-safe mapped table; existing runtime grants cover the new application table', () => {
    const migration = source(
      '../../prisma/migrations/20260926000400_mind_note_edit_recovery/migration.sql',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "note_edit_recoveries"');
    expect(migration).toContain('REFERENCES "sessions"("id") ON DELETE CASCADE');
    expect(migration).toContain('EXCEPTION WHEN duplicate_object THEN NULL');
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|GRANT|UPDATE)\s+"note_drafts"/i);
    const grants = source('../../scripts/configure-runtime-db-role.mjs');
    expect(grants).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public');
    expect(grants).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES',
    );
  });
  it('deletes all recovery data during erasure and independently discovers future unguarded checkpoint routes', () => {
    expect(DPDP_ERASURE_MANIFEST.NoteEditRecovery.disposition).toBe('DELETE');
    expect(source('lib/dpdp-erasure.ts')).toContain('tx.noteEditRecovery.deleteMany');
    const discovered = analyzeRegulatedRouteSource(`export async function GET(req: Request) {
      return Response.json(await prisma.noteEditRecovery.findMany());
    }`);
    expect(discovered.unguardedMethods).toEqual(['GET']);
  });
});
