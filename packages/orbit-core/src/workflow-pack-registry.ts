import { BEHAVIORAL_HEALTH_PACK } from './behavioral-health-pack';
import { MEDICAL_CARE_PACK } from './medical-care-pack';
import type { WorkflowPackDefinition } from './workflow-pack';

/** Canonical built-in ORBIT workflow-pack registry. */
export const ORBIT_WORKFLOW_PACKS: readonly WorkflowPackDefinition[] = Object.freeze([
  BEHAVIORAL_HEALTH_PACK,
  MEDICAL_CARE_PACK,
]);
