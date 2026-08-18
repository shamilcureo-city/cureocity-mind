import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import {
  LEGACY_PATIENT_API_DEPRECATION,
  LEGACY_PATIENT_API_SUNSET,
  markLegacyPatientResponse,
  stripLegacyPatientHeaders,
} from './patient-compatibility';

describe('Patient API compatibility headers', () => {
  it('marks a legacy Client response without changing its status or body', async () => {
    const response = markLegacyPatientResponse(
      NextResponse.json({ id: 'patient-1' }, { status: 201 }),
      '/api/v1/patients/patient-1',
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'patient-1' });
    expect(response.headers.get('Deprecation')).toBe(LEGACY_PATIENT_API_DEPRECATION);
    expect(response.headers.get('Sunset')).toBe(LEGACY_PATIENT_API_SUNSET);
    expect(response.headers.get('Link')).toBe(
      '</api/v1/patients/patient-1>; rel="successor-version"',
    );
    expect(response.headers.get('X-ORBIT-Compatibility')).toBe('legacy-client-resource');
  });

  it('preserves existing Link metadata while adding and removing the successor', () => {
    const response = NextResponse.json({ ok: true });
    response.headers.set('Link', '</docs>; rel="help"');

    markLegacyPatientResponse(response, '/api/v1/patients');
    expect(response.headers.get('Link')).toBe(
      '</docs>; rel="help", </api/v1/patients>; rel="successor-version"',
    );

    stripLegacyPatientHeaders(response, '/api/v1/patients');
    expect(response.headers.get('Link')).toBe('</docs>; rel="help"');
    expect(response.headers.has('Deprecation')).toBe(false);
    expect(response.headers.has('Sunset')).toBe(false);
    expect(response.headers.has('X-ORBIT-Compatibility')).toBe(false);
  });
});
