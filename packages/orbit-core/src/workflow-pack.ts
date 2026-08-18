import type { PractitionerCapability } from '@cureocity/contracts';
import type { EncounterProfile } from './domain';
import type { EncounterCaptureStrategy } from './encounter-lifecycle';

export type WorkflowPackId = 'BEHAVIORAL_HEALTH' | 'MEDICAL_CARE';

export interface WorkflowPackDocument {
  kind: string;
  label: string;
  requiresClinicianConfirmation: boolean;
}

export interface WorkflowPackPanel {
  id: string;
  label: string;
  requiredCapabilities: readonly PractitionerCapability[];
}

export interface WorkflowPackSafetyPolicy {
  id: string;
  description: string;
  enforcedAt: 'ENCOUNTER_START' | 'DRAFT_GENERATION' | 'CLINICIAN_CONFIRMATION';
}

export interface WorkflowPackIntegration {
  id: string;
  label: string;
  requiredCapability: PractitionerCapability;
}

export interface WorkflowPackDefinition {
  id: WorkflowPackId;
  displayName: string;
  requiredCapability: PractitionerCapability;
  encounterProfiles: readonly EncounterProfile[];
  captureStrategies: readonly EncounterCaptureStrategy[];
  documents: readonly WorkflowPackDocument[];
  panels: readonly WorkflowPackPanel[];
  measures: readonly string[];
  integrations: readonly WorkflowPackIntegration[];
  safetyPolicies: readonly WorkflowPackSafetyPolicy[];
}

export function activeWorkflowPacks(
  capabilities: readonly PractitionerCapability[],
  registry: readonly WorkflowPackDefinition[],
): WorkflowPackDefinition[] {
  const enabled = new Set(capabilities);
  return registry.filter((pack) => enabled.has(pack.requiredCapability));
}

/** Returns the pack manifest with optional panels removed when authority is absent. */
export function materializeWorkflowPack(
  pack: WorkflowPackDefinition,
  capabilities: readonly PractitionerCapability[],
): WorkflowPackDefinition {
  const enabled = new Set(capabilities);
  return {
    ...pack,
    panels: pack.panels.filter((panel) =>
      panel.requiredCapabilities.every((capability) => enabled.has(capability)),
    ),
    integrations: pack.integrations.filter((integration) =>
      enabled.has(integration.requiredCapability),
    ),
  };
}

export function validateWorkflowPack(pack: WorkflowPackDefinition): void {
  requireUnique(
    pack.documents.map((document) => document.kind),
    `${pack.id} document kind`,
  );
  requireUnique(
    pack.panels.map((panel) => panel.id),
    `${pack.id} panel`,
  );
  requireUnique(
    pack.safetyPolicies.map((policy) => policy.id),
    `${pack.id} safety policy`,
  );
  requireUnique(
    pack.integrations.map((integration) => integration.id),
    `${pack.id} integration`,
  );
  if (!pack.encounterProfiles.length)
    throw new Error(`${pack.id} must register an encounter profile`);
  if (!pack.documents.length) throw new Error(`${pack.id} must register a document`);
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label}s must be unique`);
}
