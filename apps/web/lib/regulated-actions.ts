import type { PractitionerCapability } from '@cureocity/contracts';

export interface MedicalActionRequest {
  medications: number;
  clinicalOrders: number;
  hasVitals: boolean;
  hasRxPad: boolean;
}

/**
 * Vitals embedded in a MedicalEncounterNote are part of the medical
 * documentation artifact. CHRONIC_CARE applies only when the same values are
 * copied into longitudinal ClinicalReading history.
 */
export const EMBEDDED_ENCOUNTER_VITALS_POLICY = {
  artifactCapability: 'MEDICAL_DOCUMENTATION',
  longitudinalPersistenceCapability: 'CHRONIC_CARE',
} as const satisfies {
  artifactCapability: PractitionerCapability;
  longitudinalPersistenceCapability: PractitionerCapability;
};

/** Capabilities for independently optional medical actions in a mixed request. */
export function requiredMedicalCapabilities(input: MedicalActionRequest): PractitionerCapability[] {
  const required: PractitionerCapability[] = [];
  if (input.medications > 0 || input.hasRxPad) required.push('PRESCRIPTION_DRAFTING');
  if (input.clinicalOrders > 0) required.push('CLINICAL_ORDERS');
  // `hasVitals` does not add CHRONIC_CARE: the note artifact is already gated
  // by MEDICAL_DOCUMENTATION. Longitudinal persistence is separately guarded.
  return required;
}
