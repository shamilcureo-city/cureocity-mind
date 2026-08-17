import type { WorkflowPackDefinition } from './workflow-pack';

export const BEHAVIORAL_HEALTH_PACK = Object.freeze({
  id: 'BEHAVIORAL_HEALTH',
  displayName: 'Behavioral Health',
  requiredCapability: 'BEHAVIORAL_HEALTH_DOCUMENTATION',
  encounterProfiles: [
    'BEHAVIORAL_HEALTH_INTAKE',
    'BEHAVIORAL_HEALTH_FOLLOWUP',
    'BEHAVIORAL_HEALTH_REVIEW',
  ],
  captureStrategies: ['BATCH_AMBIENT', 'DICTATION', 'MANUAL', 'UPLOAD'],
  documents: [
    { kind: 'INTAKE_NOTE', label: 'Intake note', requiresClinicianConfirmation: true },
    { kind: 'THERAPY_NOTE', label: 'Therapy note', requiresClinicianConfirmation: true },
    { kind: 'CLINICAL_REPORT', label: 'Clinical report', requiresClinicianConfirmation: true },
    { kind: 'TREATMENT_PLAN', label: 'Treatment plan', requiresClinicianConfirmation: true },
    { kind: 'SAFETY_PLAN', label: 'Safety plan', requiresClinicianConfirmation: true },
  ],
  panels: [
    {
      id: 'case-formulation',
      label: 'Case formulation',
      requiredCapabilities: ['CLINICAL_ANALYSIS'],
    },
    {
      id: 'therapy-workflow',
      label: 'Therapy workflow',
      requiredCapabilities: ['THERAPY_WORKFLOWS'],
    },
    {
      id: 'measures',
      label: 'Measures',
      requiredCapabilities: ['MEASUREMENT_BASED_CARE'],
    },
    {
      id: 'safety-plan',
      label: 'Safety plan',
      requiredCapabilities: ['SAFETY_PLANNING'],
    },
    {
      id: 'sharing',
      label: 'Patient sharing',
      requiredCapabilities: ['PATIENT_SHARING'],
    },
  ],
  measures: ['PHQ9', 'GAD7'],
  integrations: [],
  safetyPolicies: [
    {
      id: 'recording-consent',
      description: 'A consent snapshot is required before encounter capture starts.',
      enforcedAt: 'ENCOUNTER_START',
    },
    {
      id: 'crisis-signal-review',
      description: 'Detected crisis signals must remain visible for clinician review.',
      enforcedAt: 'DRAFT_GENERATION',
    },
    {
      id: 'clinician-note-confirmation',
      description: 'Generated clinical documents remain drafts until clinician confirmation.',
      enforcedAt: 'CLINICIAN_CONFIRMATION',
    },
  ],
} satisfies WorkflowPackDefinition);
