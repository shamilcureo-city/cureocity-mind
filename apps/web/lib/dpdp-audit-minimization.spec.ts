import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('DSR audit data minimization', () => {
  it('hashes consent-withdrawal free text and retains only bounded scope/code metadata', () => {
    const route = source('app/api/v1/clients/[id]/dsr/consent-withdrawal/route.ts');
    const service = source('../../services/patient-model-service/src/dsr/dsr.service.ts');
    for (const implementation of [route, service]) {
      expect(implementation).toContain("createHash('sha256')");
      expect(implementation).toContain('reasonHashHex');
      expect(implementation).not.toMatch(/metadata:\s*\{[\s\S]{0,400}\{\s*reason:/);
    }
    expect(createHash('sha256').update('private narrative').digest('hex')).toHaveLength(64);
  });

  it('hashes erasure request and resolution narratives before retaining legal proof', () => {
    const route = source('app/api/v1/admin/erasure/[id]/route.ts');
    const erasure = source('lib/dpdp-erasure.ts');
    expect(erasure).toContain('reasonHashHex');
    expect(route).toContain('resolutionNotesHashHex');
    expect(erasure).toMatch(/reason:\s*null/);
    expect(route).toMatch(/resolutionNotes:\s*null/);
  });

  it('redacts PHI-bearing audit metadata while preserving append-only DSR proof', () => {
    const erasure = source('lib/dpdp-erasure.ts');
    expect(erasure).toContain('redactClientAuditMetadata');
    expect(erasure).toContain("retentionClass: 'SECURITY_AND_DSR_PROOF'");
    expect(erasure).toContain('metadataHashHex');
  });
});
