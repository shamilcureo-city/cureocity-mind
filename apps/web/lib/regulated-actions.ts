import type { PractitionerCapability } from '@cureocity/contracts';

export interface MedicalActionRequest {
  medications: number;
  clinicalOrders: number;
  hasVitals: boolean;
  hasRxPad: boolean;
}

/** Capabilities for independently optional medical actions in a mixed request. */
export function requiredMedicalCapabilities(input: MedicalActionRequest): PractitionerCapability[] {
  const required: PractitionerCapability[] = [];
  if (input.medications > 0 || input.hasRxPad) required.push('PRESCRIPTION_DRAFTING');
  if (input.clinicalOrders > 0) required.push('CLINICAL_ORDERS');
  if (input.hasVitals) required.push('CHRONIC_CARE');
  return required;
}
