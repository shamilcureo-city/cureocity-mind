import type { PractitionerCapability } from '@cureocity/contracts';

export type RegulatedRequirement = PractitionerCapability | 'VERTICAL_DOCUMENTATION';

export interface RegulatedRouteCapability {
  /** Next.js API path, with dynamic segments left in [brackets]. */
  route: `api/v1/${string}`;
  methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  requirements: readonly RegulatedRequirement[];
  /** `any` is used only for independently-filtered mixed disclosures. */
  mode?: 'all' | 'any';
  boundary: 'read' | 'write' | 'disclosure' | 'background' | 'live';
}

const policy = (
  route: RegulatedRouteCapability['route'],
  methods: RegulatedRouteCapability['methods'],
  requirements: RegulatedRouteCapability['requirements'],
  boundary: RegulatedRouteCapability['boundary'],
  mode: RegulatedRouteCapability['mode'] = 'all',
): RegulatedRouteCapability => ({ route, methods, requirements, boundary, mode });

/**
 * Complete inventory of practitioner-facing regulated clinical API boundaries.
 *
 * `VERTICAL_DOCUMENTATION` resolves to MEDICAL_DOCUMENTATION for a doctor
 * session/record and BEHAVIORAL_HEALTH_DOCUMENTATION for a therapist
 * session/record. Entries are intentionally explicit rather than inferred from
 * route names so additions are reviewable and testable.
 */
export const REGULATED_ROUTE_CAPABILITIES = [
  // Clinical documentation artifacts and disclosures.
  policy('api/v1/sessions/[id]', ['GET'], ['VERTICAL_DOCUMENTATION'], 'disclosure'),
  policy(
    'api/v1/sessions/[id]/therapy-note',
    ['GET'],
    ['BEHAVIORAL_HEALTH_DOCUMENTATION'],
    'disclosure',
  ),
  policy(
    'api/v1/sessions/[id]/end',
    ['POST'],
    ['AMBIENT_CAPTURE', 'VERTICAL_DOCUMENTATION'],
    'write',
  ),
  policy('api/v1/sessions/[id]/problems', ['PUT'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/sessions/[id]/note-draft', ['GET', 'PUT'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/sessions/[id]/note/edit', ['POST'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy(
    'api/v1/sessions/[id]/note/edit-history',
    ['GET'],
    ['VERTICAL_DOCUMENTATION'],
    'disclosure',
  ),
  policy('api/v1/sessions/[id]/note/modify', ['POST'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/sessions/[id]/note/pdf', ['GET'], ['VERTICAL_DOCUMENTATION'], 'disclosure'),
  policy('api/v1/sessions/[id]/note/review', ['GET', 'POST'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/sessions/[id]/note/unlock', ['POST'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/sessions/[id]/note-template', ['POST'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/sessions/[id]/generate-note', ['POST'], ['VERTICAL_DOCUMENTATION'], 'background'),
  policy('api/v1/sessions/[id]/sign', ['POST'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/search/notes', ['GET'], ['BEHAVIORAL_HEALTH_DOCUMENTATION'], 'disclosure'),
  policy(
    'api/v1/clients/[id]/case-file/pdf',
    ['GET'],
    ['BEHAVIORAL_HEALTH_DOCUMENTATION'],
    'disclosure',
  ),
  policy('api/v1/sessions/[id]/audio', ['GET'], ['AMBIENT_CAPTURE'], 'disclosure'),
  policy('api/v1/audio/chunks/upload', ['POST'], ['AMBIENT_CAPTURE'], 'write'),

  // Clinical analysis, reports and synthesized decision support.
  policy('api/v1/sessions/[id]/clinical-analysis', ['GET', 'POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/sessions/[id]/differential', ['GET', 'POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/sessions/[id]/clinical-report/pdf', ['GET'], ['CLINICAL_ANALYSIS'], 'disclosure'),
  policy(
    'api/v1/clinical-reports/[id]/sections/[section]',
    ['PATCH'],
    ['CLINICAL_ANALYSIS'],
    'write',
  ),
  policy('api/v1/clinical-reports/[id]/plan-suggestion', ['POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clinical-reports/[id]/finish-review', ['POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clinical-reports/[id]/intake-plan', ['POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clinical-reports/[id]/intake-diagnosis', ['POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clinical-reports/[id]/intake-crisis', ['POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clients/[id]/pre-session-brief', ['GET'], ['CLINICAL_ANALYSIS'], 'disclosure'),
  policy('api/v1/clients/[id]/case-briefing', ['GET', 'POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clients/[id]/case-consult', ['GET', 'POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clients/[id]/formulation', ['GET', 'POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clients/[id]/conceptual-map', ['GET', 'POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy('api/v1/clients/[id]/affect/baseline', ['GET'], ['CLINICAL_ANALYSIS'], 'disclosure'),
  policy('api/v1/clients/[id]/affect/trend', ['GET'], ['CLINICAL_ANALYSIS'], 'disclosure'),
  policy('api/v1/clients/[id]/assessment-items', ['GET'], ['CLINICAL_ANALYSIS'], 'disclosure'),
  policy(
    'api/v1/clients/[id]/assessment-items/[itemId]',
    ['PATCH'],
    ['CLINICAL_ANALYSIS'],
    'write',
  ),
  policy('api/v1/clients/[id]/carried-questions', ['POST'], ['CLINICAL_ANALYSIS'], 'write'),
  policy(
    'api/v1/clients/[id]/diagnoses/[diagnosisId]',
    ['PATCH', 'DELETE'],
    ['CLINICAL_ANALYSIS'],
    'write',
  ),
  policy('api/v1/clients/[id]/prepare', ['GET'], ['CLINICAL_ANALYSIS'], 'disclosure'),
  policy('api/v1/practice-assistant/chat', ['POST'], ['CLINICAL_ANALYSIS'], 'disclosure'),

  // Maintained problem lists are part of the vertical clinical record.
  policy('api/v1/clients/[id]/problems', ['POST'], ['VERTICAL_DOCUMENTATION'], 'write'),
  policy(
    'api/v1/clients/[id]/problems/[problemId]',
    ['PATCH', 'DELETE'],
    ['VERTICAL_DOCUMENTATION'],
    'write',
  ),

  // Therapy workflow state and treatment artifacts.
  policy('api/v1/workflows', ['POST'], ['THERAPY_WORKFLOWS'], 'write'),
  policy('api/v1/workflows/[id]', ['GET'], ['THERAPY_WORKFLOWS'], 'read'),
  policy('api/v1/workflows/[id]/transitions', ['POST'], ['THERAPY_WORKFLOWS'], 'write'),
  policy('api/v1/workflows/[id]/goals/[goalId]', ['PATCH'], ['THERAPY_WORKFLOWS'], 'write'),
  policy('api/v1/workflows/[id]/prescribed-exercises', ['GET'], ['THERAPY_WORKFLOWS'], 'read'),
  policy('api/v1/workflows/[id]/advancement-suggestion', ['GET'], ['THERAPY_WORKFLOWS'], 'read'),
  policy(
    'api/v1/workflows/[id]/emdr/preparation-complete',
    ['POST'],
    ['THERAPY_WORKFLOWS'],
    'write',
  ),
  policy('api/v1/workflows/[id]/emdr/targets', ['GET', 'POST'], ['THERAPY_WORKFLOWS'], 'write'),
  policy(
    'api/v1/workflows/[id]/emdr/targets/[targetId]',
    ['PATCH'],
    ['THERAPY_WORKFLOWS'],
    'write',
  ),
  policy('api/v1/clients/[id]/workflow', ['GET'], ['THERAPY_WORKFLOWS'], 'read'),
  policy('api/v1/clients/[id]/therapy-scripts', ['GET'], ['THERAPY_WORKFLOWS'], 'disclosure'),
  policy('api/v1/clients/[id]/assignments', ['GET'], ['THERAPY_WORKFLOWS'], 'read'),
  policy('api/v1/assignments', ['POST'], ['THERAPY_WORKFLOWS'], 'write'),
  policy('api/v1/assignments/[id]', ['PATCH'], ['THERAPY_WORKFLOWS'], 'write'),
  policy('api/v1/treatment-plans/[id]/goals/[index]', ['PATCH'], ['THERAPY_WORKFLOWS'], 'write'),

  // Measurement-based care and safety planning.
  policy('api/v1/clients/[id]/instruments', ['GET', 'POST'], ['MEASUREMENT_BASED_CARE'], 'write'),
  policy('api/v1/clients/[id]/journey', ['GET'], ['MEASUREMENT_BASED_CARE'], 'disclosure'),
  policy('api/v1/clients/[id]/discharge', ['POST'], ['MEASUREMENT_BASED_CARE'], 'write'),
  policy(
    'api/v1/clients/[id]/discharge-summary/pdf',
    ['GET'],
    ['MEASUREMENT_BASED_CARE'],
    'disclosure',
  ),
  policy('api/v1/clients/[id]/adherence', ['GET'], ['MEASUREMENT_BASED_CARE'], 'read'),
  policy('api/v1/clients/[id]/safety-plan', ['GET', 'POST'], ['SAFETY_PLANNING'], 'write'),

  // Prescribing, orders, chronic-care history and interoperability.
  policy('api/v1/sessions/[id]/rx-pad', ['GET', 'PATCH'], ['PRESCRIPTION_DRAFTING'], 'write'),
  policy('api/v1/sessions/[id]/rx/pdf', ['GET'], ['PRESCRIPTION_DRAFTING'], 'disclosure'),
  policy('api/v1/medication-orders/[id]', ['PATCH'], ['PRESCRIPTION_DRAFTING'], 'write'),
  policy('api/v1/clinical-orders/[id]', ['PATCH'], ['CLINICAL_ORDERS'], 'write'),
  policy(
    'api/v1/sessions/[id]/orders',
    ['GET'],
    ['PRESCRIPTION_DRAFTING', 'CLINICAL_ORDERS'],
    'disclosure',
    'any',
  ),
  policy('api/v1/clients/[id]/readings', ['POST'], ['CHRONIC_CARE'], 'write'),
  policy('api/v1/clients/[id]/chronic', ['GET'], ['CHRONIC_CARE'], 'disclosure'),
  policy('api/v1/sessions/[id]/vitals', ['POST'], ['CHRONIC_CARE'], 'write'),
  policy('api/v1/sessions/[id]/fhir', ['GET'], ['FHIR_EXPORT'], 'disclosure'),
  policy('api/v1/sessions/[id]/abdm/push', ['POST'], ['ABDM_PUSH'], 'write'),

  // Patient disclosure/share surfaces.
  policy('api/v1/share', ['POST'], ['PATIENT_SHARING'], 'write'),
  policy('api/v1/share/config', ['GET'], ['PATIENT_SHARING'], 'read'),
  policy('api/v1/shares/[id]/revoke', ['POST'], ['PATIENT_SHARING'], 'write'),
  policy('api/v1/clients/[id]/shares', ['GET'], ['PATIENT_SHARING'], 'disclosure'),
  policy('api/v1/clients/[id]/letters', ['POST'], ['PATIENT_SHARING'], 'write'),
  policy('api/v1/clients/[id]/letters/[letterId]/pdf', ['GET'], ['PATIENT_SHARING'], 'disclosure'),

  // Live encounter token, ingestion and derived live outputs.
  policy(
    'api/v1/sessions/[id]/live-token',
    ['POST'],
    ['LIVE_ENCOUNTER', 'VERTICAL_DOCUMENTATION'],
    'live',
  ),
  policy(
    'api/v1/sessions/[id]/live-note',
    ['POST'],
    ['LIVE_ENCOUNTER', 'VERTICAL_DOCUMENTATION'],
    'live',
  ),
  policy('api/v1/sessions/[id]/live-suggestion', ['POST'], ['LIVE_ENCOUNTER'], 'live'),
  policy('api/v1/sessions/[id]/live-metric', ['POST'], ['LIVE_ENCOUNTER'], 'live'),
  policy('api/v1/sessions/[id]/start', ['POST'], ['AMBIENT_CAPTURE'], 'write'),
  policy('api/v1/sessions/[id]/plan-dictation', ['POST'], ['MEDICAL_DOCUMENTATION'], 'write'),
  policy('api/v1/insights', ['GET'], ['LIVE_ENCOUNTER'], 'read'),
  policy('api/v1/insights/export', ['GET'], ['LIVE_ENCOUNTER'], 'disclosure'),
] as const satisfies readonly RegulatedRouteCapability[];

export const REGULATED_ROUTE_COUNT = REGULATED_ROUTE_CAPABILITIES.length;
export const REGULATED_METHOD_BOUNDARY_COUNT = REGULATED_ROUTE_CAPABILITIES.reduce(
  (count, entry) => count + entry.methods.length,
  0,
);

function routeMatches(template: string, pathname: string): boolean {
  const expected = template.replace(/^\//, '').split('/');
  const actual = pathname.replace(/^\//, '').split('/');
  return (
    expected.length === actual.length &&
    expected.every((part, index) =>
      part.startsWith('[') ? (actual[index]?.length ?? 0) > 0 : part === actual[index],
    )
  );
}

export function regulatedPolicyForRequest(
  pathname: string,
  method: string,
): RegulatedRouteCapability | undefined {
  return REGULATED_ROUTE_CAPABILITIES.find(
    (entry) =>
      entry.methods.some((candidate) => candidate === method) &&
      routeMatches(entry.route, pathname),
  );
}

export function resolveRegulatedRequirements(
  entry: RegulatedRouteCapability,
  vertical: 'THERAPIST' | 'DOCTOR' | undefined,
): PractitionerCapability[] {
  return entry.requirements.map((requirement) =>
    requirement === 'VERTICAL_DOCUMENTATION'
      ? vertical === 'DOCTOR'
        ? 'MEDICAL_DOCUMENTATION'
        : 'BEHAVIORAL_HEALTH_DOCUMENTATION'
      : requirement,
  );
}
