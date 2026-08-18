import type { WorkflowPackDefinition } from './workflow-pack';

export const MEDICAL_CARE_PACK = Object.freeze({
  id: 'MEDICAL_CARE',
  displayName: 'Medical Care',
  requiredCapability: 'MEDICAL_DOCUMENTATION',
  encounterProfiles: ['MEDICAL_CONSULT', 'MEDICAL_FOLLOWUP'],
  captureStrategies: ['LIVE_STREAM', 'DICTATION', 'MANUAL', 'UPLOAD'],
  documents: [
    { kind: 'MEDICAL_NOTE', label: 'Medical note', requiresClinicianConfirmation: true },
    {
      kind: 'DIFFERENTIAL_ASSESSMENT',
      label: 'Differential assessment',
      requiresClinicianConfirmation: true,
    },
    {
      kind: 'MEDICATION_ORDER',
      label: 'Medication order',
      requiresClinicianConfirmation: true,
    },
    {
      kind: 'CLINICAL_ORDER',
      label: 'Clinical order',
      requiresClinicianConfirmation: true,
    },
  ],
  panels: [
    {
      id: 'medical-note',
      label: 'Medical note',
      requiredCapabilities: ['MEDICAL_DOCUMENTATION'],
    },
    {
      id: 'differential',
      label: 'Differential',
      requiredCapabilities: ['CLINICAL_ANALYSIS'],
    },
    {
      id: 'medication-drafting',
      label: 'Medication drafting',
      requiredCapabilities: ['PRESCRIPTION_DRAFTING'],
    },
    {
      id: 'prescription-signing',
      label: 'Prescription signing',
      requiredCapabilities: ['PRESCRIPTION_SIGNING'],
    },
    {
      id: 'clinical-orders',
      label: 'Clinical orders',
      requiredCapabilities: ['CLINICAL_ORDERS'],
    },
    {
      id: 'chronic-care',
      label: 'Chronic care',
      requiredCapabilities: ['CHRONIC_CARE'],
    },
    { id: 'fhir-export', label: 'FHIR export', requiredCapabilities: ['FHIR_EXPORT'] },
    { id: 'abdm-push', label: 'ABDM push', requiredCapabilities: ['ABDM_PUSH'] },
  ],
  measures: ['BLOOD_PRESSURE', 'BLOOD_GLUCOSE', 'HBA1C'],
  integrations: [
    { id: 'FHIR_R4', label: 'FHIR R4', requiredCapability: 'FHIR_EXPORT' },
    { id: 'ABDM', label: 'Ayushman Bharat Digital Mission', requiredCapability: 'ABDM_PUSH' },
  ],
  safetyPolicies: [
    {
      id: 'encounter-consent',
      description: 'A consent snapshot is required before live or recorded capture starts.',
      declarationCheckpoint: 'ENCOUNTER_START',
    },
    {
      id: 'differential-is-advisory',
      description:
        'Generated differential reasoning remains advisory until clinician confirmation.',
      declarationCheckpoint: 'CLINICIAN_CONFIRMATION',
    },
    {
      id: 'prescription-signing-authority',
      description: 'Medication drafting never implies authority to sign a prescription.',
      declarationCheckpoint: 'CLINICIAN_CONFIRMATION',
    },
    {
      id: 'external-export-confirmation',
      description: 'FHIR export and ABDM push require explicit clinician confirmation.',
      declarationCheckpoint: 'CLINICIAN_CONFIRMATION',
    },
  ],
} satisfies WorkflowPackDefinition);
