import type { PractitionerCapability } from '@cureocity/contracts';

export interface PatientWorkspaceMode {
  behavioral: boolean;
  medical: boolean;
  medicalOnly: boolean;
}

export function resolvePatientWorkspaceMode(
  capabilities: readonly PractitionerCapability[],
): PatientWorkspaceMode {
  const enabled = new Set(capabilities);
  const behavioral = enabled.has('BEHAVIORAL_HEALTH_DOCUMENTATION');
  const medical = enabled.has('MEDICAL_DOCUMENTATION');
  return { behavioral, medical, medicalOnly: medical && !behavioral };
}

export function patientEncounterHref(
  patientId: string,
  encounterId: string,
  mode: PatientWorkspaceMode,
): string {
  return mode.medicalOnly
    ? `/app/patients/${patientId}/encounters/${encounterId}`
    : `/app/sessions/${encounterId}`;
}
