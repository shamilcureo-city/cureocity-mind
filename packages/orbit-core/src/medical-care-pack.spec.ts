import { describe, expect, it } from 'vitest';
import { BEHAVIORAL_HEALTH_PACK } from './behavioral-health-pack';
import { MEDICAL_CARE_PACK } from './medical-care-pack';
import {
  activeWorkflowPacks,
  materializeWorkflowPack,
  validateWorkflowPack,
} from './workflow-pack';

describe('Medical Care workflow pack', () => {
  it('registers medical documents, chronic measures, integrations, and safety policies', () => {
    expect(() => validateWorkflowPack(MEDICAL_CARE_PACK)).not.toThrow();
    expect(MEDICAL_CARE_PACK.documents.map((document) => document.kind)).toEqual([
      'MEDICAL_NOTE',
      'DIFFERENTIAL_ASSESSMENT',
      'MEDICATION_ORDER',
      'CLINICAL_ORDER',
    ]);
    expect(MEDICAL_CARE_PACK.integrations.map((integration) => integration.id)).toEqual([
      'FHIR_R4',
      'ABDM',
    ]);
    expect(MEDICAL_CARE_PACK.safetyPolicies).toHaveLength(4);
  });

  it('keeps prescription signing separate from drafting authority', () => {
    const drafting = materializeWorkflowPack(MEDICAL_CARE_PACK, [
      'MEDICAL_DOCUMENTATION',
      'PRESCRIPTION_DRAFTING',
    ]);
    expect(drafting.panels.map((panel) => panel.id)).toContain('medication-drafting');
    expect(drafting.panels.map((panel) => panel.id)).not.toContain('prescription-signing');
  });

  it('filters FHIR and ABDM integrations independently', () => {
    const fhirOnly = materializeWorkflowPack(MEDICAL_CARE_PACK, [
      'MEDICAL_DOCUMENTATION',
      'FHIR_EXPORT',
    ]);
    expect(fhirOnly.integrations.map((integration) => integration.id)).toEqual(['FHIR_R4']);
  });

  it('composes both packs for multidisciplinary practitioners', () => {
    expect(
      activeWorkflowPacks(
        ['BEHAVIORAL_HEALTH_DOCUMENTATION', 'MEDICAL_DOCUMENTATION'],
        [BEHAVIORAL_HEALTH_PACK, MEDICAL_CARE_PACK],
      ).map((pack) => pack.id),
    ).toEqual(['BEHAVIORAL_HEALTH', 'MEDICAL_CARE']);
  });
});
