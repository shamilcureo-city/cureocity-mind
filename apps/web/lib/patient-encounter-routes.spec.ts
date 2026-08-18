import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Patient and Encounter compatibility routes', () => {
  it('marks every legacy Client route response with its canonical successor', () => {
    const collection = source('app/api/v1/clients/route.ts');
    const detail = source('app/api/v1/clients/[id]/route.ts');

    expect(collection).toContain('markLegacyPatientResponse');
    expect(collection).toContain("'/api/v1/patients'");
    expect(collection).toContain('legacyClientGET');
    expect(collection).toContain('legacyClientPOST');
    expect(detail).toContain('markLegacyPatientResponse');
    expect(detail).toContain('`/api/v1/patients/${id}`');
    expect(detail).toContain('legacyClientGET');
    expect(detail).toContain('legacyClientPATCH');
    expect(detail).toContain('legacyClientDELETE');
  });

  it('keeps canonical Patient responses free of legacy migration headers', () => {
    const collection = source('app/api/v1/patients/route.ts');
    const detail = source('app/api/v1/patients/[id]/route.ts');

    expect(collection).toContain('stripLegacyPatientHeaders');
    expect(collection).toContain("'/api/v1/patients'");
    expect(detail).toContain('stripLegacyPatientHeaders');
    expect(detail).toContain('`/api/v1/patients/${id}`');
  });

  it('implements Encounter routes only as delegates to current Session handlers', () => {
    const adapters = [
      ['app/api/v1/encounters/route.ts', "from '../sessions/route'"],
      ['app/api/v1/encounters/[id]/route.ts', "from '../../sessions/[id]/route'"],
      ['app/api/v1/encounters/[id]/start/route.ts', "from '../../../sessions/[id]/start/route'"],
      ['app/api/v1/encounters/[id]/complete/route.ts', "from '../../../sessions/[id]/end/route'"],
      [
        'app/api/v1/encounters/[id]/no-show/route.ts',
        "from '../../../sessions/[id]/no-show/route'",
      ],
    ] as const;

    for (const [route, target] of adapters) {
      const adapter = source(route);
      expect(adapter).toContain(target);
      expect(adapter).not.toContain('prisma');
      expect(adapter).not.toContain('$transaction');
      expect(adapter).not.toContain('writeAudit');
      expect(adapter).not.toContain('encounterApplicationService');
    }
  });
});
