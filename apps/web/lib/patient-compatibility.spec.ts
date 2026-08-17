import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { LEGACY_PATIENT_API_SUNSET, markLegacyPatientResponse } from './patient-compatibility';

describe('patient compatibility response', () => {
  it('advertises the canonical API without changing status or body', async () => {
    const response = markLegacyPatientResponse(
      NextResponse.json({ id: 'patient-1' }, { status: 201 }),
      '/api/v1/patients/patient-1',
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'patient-1' });
    expect(response.headers.get('Deprecation')).toBe('true');
    expect(response.headers.get('Sunset')).toBe(LEGACY_PATIENT_API_SUNSET);
    expect(response.headers.get('Link')).toBe(
      '</api/v1/patients/patient-1>; rel="successor-version"',
    );
  });
});
