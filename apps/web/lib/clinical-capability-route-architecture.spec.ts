import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGULATED_ROUTE_CAPABILITIES } from './regulated-route-capabilities';
import { analyzeRegulatedRouteSource, exportedRouteHandlers } from './regulated-route-discovery';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('regulated boundary coverage', () => {
  it('publishes the route policy as a machine-readable inventory', () => {
    expect(existsSync(resolve(process.cwd(), 'lib/regulated-route-capabilities.ts'))).toBe(true);
    expect(REGULATED_ROUTE_CAPABILITIES.length).toBeGreaterThan(60);
  });

  it('contains exactly one policy entry per route and method boundary', () => {
    const boundaries = REGULATED_ROUTE_CAPABILITIES.flatMap((entry) =>
      entry.methods.map((method) => `${entry.route}:${method}`),
    );
    expect(new Set(boundaries).size).toBe(boundaries.length);
  });

  it('classifies every discovered practitioner clinical-data boundary', () => {
    const apiRoot = resolve(process.cwd(), 'app/api/v1');
    const classified = new Set(
      REGULATED_ROUTE_CAPABILITIES.flatMap((entry) =>
        entry.methods.map((method) => `${entry.route}:${method}`),
      ),
    );
    const missing: string[] = [];

    for (const item of readdirSync(apiRoot, { recursive: true, withFileTypes: true })) {
      if (!item.isFile() || item.name !== 'route.ts') continue;
      const path = resolve(item.parentPath, item.name);
      const routeSource = readFileSync(path, 'utf8');
      // Operator-only erasure and synthetic health checks mention clinical
      // models but are governed by ADMIN/health authentication, not a
      // practitioner clinical capability.
      if (
        path.includes('/api/v1/admin/') ||
        path.includes('/api/v1/health/') ||
        path.includes('/api/v1/internal/') ||
        path.includes('/api/v1/cron/') ||
        path.includes('/api/v1/care/') ||
        path.includes('/api/v1/p/') ||
        path.includes('/api/v1/billing/') ||
        path.includes('/api/v1/psychologists/me/marketing/') ||
        path.includes('/api/v1/psychologists/me/posts/')
      ) {
        continue;
      }
      const route = `api/v1/${relative(apiRoot, path).replace(/\/route\.ts$/, '')}`;
      for (const handler of analyzeRegulatedRouteSource(routeSource).regulatedHandlers) {
        const key = `${route}:${handler.method}`;
        if (!classified.has(key)) missing.push(key);
      }
    }

    expect(missing).toEqual([]);
  });

  it('enforces every inventory entry through the shared authenticated boundary', () => {
    const authServer = source('lib/auth-server.ts');
    expect(authServer).toContain('regulatedPolicyForRequest');
    for (const entry of REGULATED_ROUTE_CAPABILITIES) {
      const routeFile = `app/${entry.route}/route.ts`;
      expect(existsSync(resolve(process.cwd(), routeFile)), routeFile).toBe(true);
      const routeSource = source(routeFile);
      const analysis = analyzeRegulatedRouteSource(routeSource);
      for (const method of entry.methods) {
        expect(analysis.unguardedMethods, routeFile).not.toContain(method);
        expect(analysis.guardOrderViolations, routeFile).not.toContain(method);
      }
      const actualMethods = exportedRouteHandlers(routeSource)
        .map((handler) => handler.method)
        .sort();
      expect([...entry.methods].sort(), routeFile).toEqual(actualMethods);
    }
  });

  it('discovers an unguarded regulated route independently of guard presence', () => {
    const fixture = `
      export async function POST(req: Request) {
        const note = await prisma.noteDraft.findUnique({ where: { id: 'n1' } });
        return Response.json(note);
      }
    `;
    const analysis = analyzeRegulatedRouteSource(fixture);
    expect(analysis.regulatedHandlers.map((handler) => handler.method)).toEqual(['POST']);
    expect(analysis.unguardedMethods).toEqual(['POST']);
  });

  it('checks each exported handler segment instead of accepting a file-wide guard', () => {
    const fixture = `
      export async function GET(req: Request) {
        const auth = await requirePsychologistId(req);
        if (!auth.ok) return auth.response;
        return Response.json(await prisma.noteDraft.findMany());
      }
      export async function PUT(req: Request) {
        const input = await parseJson(req, UpdateNoteSchema);
        return Response.json(await prisma.noteDraft.update({ data: input }));
      }
    `;
    const analysis = analyzeRegulatedRouteSource(fixture);
    expect(analysis.unguardedMethods).toEqual(['PUT']);
    expect(analysis.guardOrderViolations).toEqual(['PUT']);
  });

  it('discovers delegated and aliased route-handler re-exports', () => {
    const fixture = `
      export { GET } from '../../sessions/[id]/route';
      export { POST as PATCH } from '../../sessions/[id]/end/route';
    `;

    expect(exportedRouteHandlers(fixture).map(({ method }) => method)).toEqual(['GET', 'PATCH']);
  });

  it('classifies every Encounter compatibility pathname before its Session delegate runs', () => {
    expect(
      REGULATED_ROUTE_CAPABILITIES.filter((entry) => entry.route.includes('/encounters')).map(
        (entry) => `${entry.route}:${entry.methods.join(',')}`,
      ),
    ).toEqual([
      'api/v1/encounters:POST',
      'api/v1/encounters/[id]:GET',
      'api/v1/encounters/[id]/start:POST',
      'api/v1/encounters/[id]/complete:POST',
      'api/v1/encounters/[id]/no-show:POST',
    ]);
  });

  it.each([
    ['app/api/v1/share/route.ts', 'PATIENT_SHARING'],
    ['app/api/v1/sessions/[id]/fhir/route.ts', 'FHIR_EXPORT'],
    ['app/api/v1/sessions/[id]/abdm/push/route.ts', 'ABDM_PUSH'],
    ['app/api/v1/sessions/[id]/clinical-analysis/route.ts', 'CLINICAL_ANALYSIS'],
    ['app/api/v1/sessions/[id]/differential/route.ts', 'CLINICAL_ANALYSIS'],
    ['app/api/v1/clients/[id]/readings/route.ts', 'CHRONIC_CARE'],
    ['app/api/v1/clients/[id]/chronic/route.ts', 'CHRONIC_CARE'],
    ['app/api/v1/sessions/[id]/vitals/route.ts', 'CHRONIC_CARE'],
    ['app/api/v1/clinical-orders/[id]/route.ts', 'CLINICAL_ORDERS'],
    ['app/api/v1/medication-orders/[id]/route.ts', 'PRESCRIPTION_DRAFTING'],
    ['app/api/v1/sessions/[id]/rx/pdf/route.ts', 'PRESCRIPTION_DRAFTING'],
  ])('%s requires %s', (path, capability) => {
    expect(source(path)).toContain(`requireCapability(req, '${capability}')`);
  });

  it('gates medical sign and Rx drafting without changing therapy signing', () => {
    const sign = source('app/api/v1/sessions/[id]/sign/route.ts');
    expect(sign).toContain("requireCapability(req, 'PRESCRIPTION_SIGNING', auth)");
    expect(sign.indexOf("vertical === 'DOCTOR'")).toBeLessThan(
      sign.indexOf("'PRESCRIPTION_SIGNING'"),
    );
    expect(source('app/api/v1/sessions/[id]/rx-pad/route.ts')).toContain(
      "requireCapability(req, 'PRESCRIPTION_DRAFTING')",
    );
  });

  it('revalidates clinical analysis and differential at execution helpers', () => {
    const orchestrator = source('lib/note-orchestrator.ts');
    expect(orchestrator).toContain("source: 'runClinicalAnalysis'");
    expect(orchestrator).toContain("source: 'runDifferential'");
    expect(orchestrator).toContain("source: 'persistDraftedOrders'");
    expect(orchestrator).toContain("source: 'persistVitalReadings'");
    expect(orchestrator).toContain("source: 'runNoteGeneration'");
  });

  it('treats live-token as the mandatory live and vertical-documentation boundary', () => {
    const liveToken = source('app/api/v1/sessions/[id]/live-token/route.ts');
    expect(liveToken).toContain("requireCapability(req, 'LIVE_ENCOUNTER', auth)");
    expect(liveToken).toContain("'MEDICAL_DOCUMENTATION'");
    expect(liveToken).toContain("'BEHAVIORAL_HEALTH_DOCUMENTATION'");
    expect(liveToken).toContain('capabilities,');
  });

  it('does not invoke optional live persistence when the refreshed scope is absent', () => {
    const liveNote = source('app/api/v1/sessions/[id]/live-note/route.ts');
    expect(liveNote).toContain("capabilities?.includes('CHRONIC_CARE')");
    expect(liveNote).toContain("capabilities?.includes('PRESCRIPTION_DRAFTING')");
    expect(liveNote).toContain("capabilities?.includes('CLINICAL_ORDERS')");
  });
});
