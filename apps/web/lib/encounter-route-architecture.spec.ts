import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canonicalRoutes = [
  'app/api/v1/encounters/[id]/start/route.ts',
  'app/api/v1/encounters/[id]/complete/route.ts',
  'app/api/v1/encounters/[id]/no-show/route.ts',
];
const legacyRoutes = [
  'app/api/v1/sessions/[id]/start/route.ts',
  'app/api/v1/sessions/[id]/end/route.ts',
  'app/api/v1/sessions/[id]/no-show/route.ts',
];

describe('Encounter HTTP adapters', () => {
  it('keeps canonical routes thin and delegates business rules to the application service', () => {
    for (const route of canonicalRoutes) {
      const source = readFileSync(resolve(process.cwd(), route), 'utf8');
      expect(source).toContain('encounterApplicationService');
      expect(source).not.toContain('prisma.');
      expect(source).not.toContain('$transaction');
      expect(source).not.toContain('writeAudit(');
    }
  });

  it('keeps legacy Session transitions as compatibility-only adapters', () => {
    for (const route of legacyRoutes) {
      const source = readFileSync(resolve(process.cwd(), route), 'utf8');
      expect(source).toContain('@deprecated');
      expect(source).toContain('encounters/[id]');
      expect(source).not.toContain('encounterApplicationService');
      expect(source).not.toContain('prisma.');
    }
  });
});
