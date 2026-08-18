import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGULATED_ROUTE_CAPABILITIES } from './regulated-route-capabilities';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('regulated boundary coverage', () => {
  it('publishes the route policy as a machine-readable inventory', () => {
    expect(existsSync(resolve(process.cwd(), 'lib/regulated-route-capabilities.ts'))).toBe(true);
    expect(REGULATED_ROUTE_CAPABILITIES.length).toBeGreaterThan(60);
  });

  it('classifies every discovered practitioner clinical-data boundary', () => {
    const apiRoot = resolve(process.cwd(), 'app/api/v1');
    const markers =
      /therapyNote|noteDraft|medicalEncounterNote|clinicalReport|transcript|safetyPlan|treatmentWorkflow|modalityState|instrumentResponse|clinicalReading|medicationOrder|clinicalOrder|assessmentItem|clientDiagnosis|problemListItem|affectFeatures|preSessionBrief|decryptClientField|persistVitalReadings/i;
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
      if (path.includes('/api/v1/admin/') || path.includes('/api/v1/health/')) continue;
      if (
        !markers.test(routeSource) ||
        !/require(?:PsychologistId|Capability|AnyCapability)\(/.test(routeSource)
      ) {
        continue;
      }
      const route = `api/v1/${relative(apiRoot, path).replace(/\/route\.ts$/, '')}`;
      for (const method of routeSource.matchAll(
        /export async function (GET|POST|PUT|PATCH|DELETE)/g,
      )) {
        const key = `${route}:${method[1]}`;
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
      const guard = /require(?:PsychologistId|Capability|AnyCapability)\(/.exec(routeSource);
      expect(guard, routeFile).not.toBeNull();
      const firstProtectedOperation =
        /(?:prisma\.|parseJson\(|parseQuery\(|decryptClientField\(|renderToBuffer\(|modelRouter\(|computeClientJourney\()/.exec(
          routeSource,
        );
      if (firstProtectedOperation) {
        expect(guard!.index, routeFile).toBeLessThan(firstProtectedOperation.index);
      }
      const actualMethods = [
        ...routeSource.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g),
      ]
        .map((match) => match[1])
        .sort();
      expect([...entry.methods].sort(), routeFile).toEqual(actualMethods);
    }
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
