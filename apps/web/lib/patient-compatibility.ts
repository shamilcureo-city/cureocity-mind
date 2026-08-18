import type { NextResponse } from 'next/server';

/** RFC 9745 date form: the Client API became deprecated on 18 August 2026. */
export const LEGACY_PATIENT_API_DEPRECATION = '@1787011200';
/** RFC 8594 HTTP-date. Keep the weekday consistent with the calendar date. */
export const LEGACY_PATIENT_API_SUNSET = 'Thu, 12 Aug 2027 00:00:00 GMT';

function successorLink(canonicalPath: string): string {
  return `<${canonicalPath}>; rel="successor-version"`;
}

/** Add migration metadata without changing the legacy response status or body. */
export function markLegacyPatientResponse(
  response: NextResponse,
  canonicalPath: string,
): NextResponse {
  const successor = successorLink(canonicalPath);
  const existingLinks = response.headers.get('Link');

  response.headers.set('Deprecation', LEGACY_PATIENT_API_DEPRECATION);
  response.headers.set('Sunset', LEGACY_PATIENT_API_SUNSET);
  response.headers.set('Link', existingLinks ? `${existingLinks}, ${successor}` : successor);
  response.headers.set('X-ORBIT-Compatibility', 'legacy-client-resource');
  return response;
}

/** Remove only Client migration metadata from a canonical Patient response. */
export function stripLegacyPatientHeaders(
  response: NextResponse,
  canonicalPath: string,
): NextResponse {
  const successor = successorLink(canonicalPath);
  const links = response.headers.get('Link');

  response.headers.delete('Deprecation');
  response.headers.delete('Sunset');
  response.headers.delete('X-ORBIT-Compatibility');
  if (links === successor) {
    response.headers.delete('Link');
  } else if (links?.endsWith(`, ${successor}`)) {
    response.headers.set('Link', links.slice(0, -`, ${successor}`.length));
  }
  return response;
}
