import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('regulated boundary coverage', () => {
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
    expect(orchestrator).toContain(
      "assertSessionCapabilities(args.sessionId, ['CLINICAL_ANALYSIS'])",
    );
    expect(orchestrator).toContain('assertSessionCapabilities(sessionId, required)');
  });
});
