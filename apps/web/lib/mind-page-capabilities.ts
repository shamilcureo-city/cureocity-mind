import type { PractitionerCapability } from '@cureocity/contracts';

export type MindPageCapability = PractitionerCapability;
export type MindPage = 'today' | 'session';

const REQUIRED_MIND_PAGE_CAPABILITIES: Record<MindPage, readonly PractitionerCapability[]> = {
  today: ['BEHAVIORAL_HEALTH_DOCUMENTATION'],
  session: ['BEHAVIORAL_HEALTH_DOCUMENTATION'],
};

/** Page disclosure follows the existing session-record policy; feature panels authorize separately. */
export function canOpenMindPage(
  page: MindPage,
  capabilities: ReadonlySet<PractitionerCapability>,
): boolean {
  return REQUIRED_MIND_PAGE_CAPABILITIES[page].every((capability) => capabilities.has(capability));
}

/** Do not execute a protected query and then hide its result. */
export function loadOptionalCapabilityData<T>(
  capabilities: ReadonlySet<PractitionerCapability>,
  capability: PractitionerCapability,
  load: () => Promise<T>,
  unauthorized: T,
): Promise<T> {
  return capabilities.has(capability) ? load() : Promise.resolve(unauthorized);
}
