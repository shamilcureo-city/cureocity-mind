import type { NextResponse } from 'next/server';

export const LEGACY_PATIENT_API_SUNSET = 'Wed, 12 Aug 2027 00:00:00 GMT';

/**
 * Advertise the canonical Patient resource while legacy Client API consumers migrate.
 * The headers are machine-readable and intentionally do not change the response body.
 */
export function markLegacyPatientResponse(
  response: NextResponse,
  canonicalPath: string,
): NextResponse {
  response.headers.set('Deprecation', 'true');
  response.headers.set('Sunset', LEGACY_PATIENT_API_SUNSET);
  response.headers.set('Link', `<${canonicalPath}>; rel="successor-version"`);
  response.headers.set('X-ORBIT-Compatibility', 'legacy-client-resource');
  return response;
}
