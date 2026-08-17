import { describe, expect, it } from 'vitest';
import { patientEncounterHref, resolvePatientWorkspaceMode } from './patient-workspace';

describe('Patient workspace capability composition', () => {
  it('composes behavioral and medical panels for multidisciplinary practitioners', () => {
    expect(
      resolvePatientWorkspaceMode(['BEHAVIORAL_HEALTH_DOCUMENTATION', 'MEDICAL_DOCUMENTATION']),
    ).toEqual({ behavioral: true, medical: true, medicalOnly: false });
  });

  it('keeps current encounter adapters behind the canonical Patient timeline', () => {
    expect(
      patientEncounterHref(
        'patient-1',
        'encounter-1',
        resolvePatientWorkspaceMode(['MEDICAL_DOCUMENTATION']),
      ),
    ).toBe('/app/patients/patient-1/encounters/encounter-1');
    expect(
      patientEncounterHref(
        'patient-1',
        'encounter-1',
        resolvePatientWorkspaceMode(['BEHAVIORAL_HEALTH_DOCUMENTATION']),
      ),
    ).toBe('/app/sessions/encounter-1');
  });
});
