import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  canOpenMindPage,
  loadOptionalCapabilityData,
  type MindPageCapability,
} from './mind-page-capabilities';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const core: MindPageCapability[] = ['BEHAVIORAL_HEALTH_DOCUMENTATION'];

describe('B08 Mind page capability boundaries', () => {
  it.each(['today', 'session'] as const)(
    'lets a documentation-authorized therapist open the %s page without optional sharing or measurement',
    (page) => {
      expect(canOpenMindPage(page, new Set(core))).toBe(true);
    },
  );

  it.each(['today', 'session'] as const)(
    'fails the %s page closed without behavioral-health documentation',
    (page) => {
      expect(canOpenMindPage(page, new Set())).toBe(false);
    },
  );

  it('does not execute an optional data loader when its capability is absent', async () => {
    const query = vi.fn(async () => ['protected row']);

    await expect(
      loadOptionalCapabilityData(new Set(core), 'PATIENT_SHARING', query, []),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('executes an optional data loader when its capability is present', async () => {
    const query = vi.fn(async () => ['protected row']);

    await expect(
      loadOptionalCapabilityData(
        new Set([...core, 'MEASUREMENT_BASED_CARE']),
        'MEASUREMENT_BASED_CARE',
        query,
        [],
      ),
    ).resolves.toEqual(['protected row']);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('gates Today sharing, measurement and workflow queries before execution', () => {
    const today = read('app/app/today/page.tsx');
    expect(today).toContain("canOpenMindPage('today'");
    expect(today).toMatch(
      /loadOptionalCapabilityData\([\s\S]*?'MEASUREMENT_BASED_CARE'[\s\S]*?prisma\.instrumentResponse\.findMany/,
    );
    expect(today).toMatch(
      /loadOptionalCapabilityData\([\s\S]*?'PATIENT_SHARING'[\s\S]*?prisma\.patientShare\.findMany/,
    );
    expect(today).toMatch(
      /loadOptionalCapabilityData\([\s\S]*?'THERAPY_WORKFLOWS'[\s\S]*?prisma\.exerciseAssignment\.findMany/,
    );
    expect(today).toMatch(
      /capabilities\.has\('MEASUREMENT_BASED_CARE'\)[\s\S]*?prisma\.instrumentResponse\.groupBy/,
    );
  });

  it('keeps the existing note available while omitting unauthorized session sharing and measures', () => {
    const session = read('app/app/sessions/[id]/page.tsx');
    const notes = read('components/app/NotesTab.tsx');
    const closeout = read('components/app/MindSessionCloseout.tsx');

    expect(session).toContain("canOpenMindPage('session'");
    expect(session).toContain('canShare={canShare}');
    expect(session).toContain('includeMeasures: canUseMeasures');
    expect(session).toMatch(
      /loadOptionalCapabilityData\([\s\S]*?'PATIENT_SHARING'[\s\S]*?prisma\.patientShare\.findMany/,
    );
    expect(notes).toMatch(/canShare[\s\S]*?canShare &&[\s\S]*?<ShareModal/);
    expect(closeout).toMatch(/canShare[\s\S]*?canShare && receipts\.length > 0/);
  });

  it('does not weaken regulated API route capability policy', () => {
    const policy = read('lib/regulated-route-capabilities.ts');
    expect(policy).toContain(
      "policy('api/v1/sessions/[id]', ['GET'], ['VERTICAL_DOCUMENTATION'], 'disclosure')",
    );
    expect(policy).toContain("policy('api/v1/share', ['POST'], ['PATIENT_SHARING'], 'write')");
    expect(policy).toContain(
      "policy('api/v1/clients/[id]/instruments', ['GET', 'POST'], ['MEASUREMENT_BASED_CARE'], 'write')",
    );
  });
});
