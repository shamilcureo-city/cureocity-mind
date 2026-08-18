import { describe, expect, it } from 'vitest';
import { BEHAVIORAL_HEALTH_PACK } from './behavioral-health-pack';
import {
  activeWorkflowPacks,
  materializeWorkflowPack,
  validateWorkflowPack,
} from './workflow-pack';

describe('Behavioral Health workflow pack', () => {
  it('registers existing profiles, documents, panels, measures, and safety policies', () => {
    expect(() => validateWorkflowPack(BEHAVIORAL_HEALTH_PACK)).not.toThrow();
    expect(BEHAVIORAL_HEALTH_PACK.encounterProfiles).toHaveLength(3);
    expect(BEHAVIORAL_HEALTH_PACK.documents.map((document) => document.kind)).toContain(
      'THERAPY_NOTE',
    );
    expect(BEHAVIORAL_HEALTH_PACK.measures).toEqual(['PHQ9', 'GAD7']);
    expect(BEHAVIORAL_HEALTH_PACK.safetyPolicies).toHaveLength(3);
  });

  it('labels safety policy checkpoints as declarative metadata', () => {
    const policy = BEHAVIORAL_HEALTH_PACK.safetyPolicies[0];

    expect(policy).toHaveProperty('declarationCheckpoint', 'ENCOUNTER_START');
    expect(policy).not.toHaveProperty('enforcedAt');
  });

  it('activates only with behavioral documentation authority', () => {
    expect(activeWorkflowPacks(['MEDICAL_DOCUMENTATION'], [BEHAVIORAL_HEALTH_PACK])).toEqual([]);
    expect(
      activeWorkflowPacks(['BEHAVIORAL_HEALTH_DOCUMENTATION'], [BEHAVIORAL_HEALTH_PACK]),
    ).toEqual([BEHAVIORAL_HEALTH_PACK]);
  });

  it('materializes optional panels from effective capabilities', () => {
    const pack = materializeWorkflowPack(BEHAVIORAL_HEALTH_PACK, [
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
      'MEASUREMENT_BASED_CARE',
      'SAFETY_PLANNING',
    ]);
    expect(pack.panels.map((panel) => panel.id)).toEqual(['measures', 'safety-plan']);
  });
});
