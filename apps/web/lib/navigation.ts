import type { PractitionerCapability } from '@cureocity/contracts';

export type OrbitNavIcon =
  | 'dashboard'
  | 'today'
  | 'record'
  | 'clients'
  | 'templates'
  | 'assistant'
  | 'learn'
  | 'me'
  | 'cog';

export interface OrbitNavItem {
  id: 'today' | 'patients' | 'encounters' | 'assistant' | 'analytics' | 'templates' | 'learn';
  href: string;
  label: string;
  icon: OrbitNavIcon;
  mobile: boolean;
}

export interface OrbitNavigation {
  items: OrbitNavItem[];
  newEncounterHref: string;
}

/**
 * One ORBIT information architecture. Capabilities select compatible
 * destinations while legacy patient/session routes are retired in Sprints 5–7.
 */
export function buildOrbitNavigation(
  capabilities: readonly PractitionerCapability[],
): OrbitNavigation {
  const enabled = new Set(capabilities);
  const behavioral = enabled.has('BEHAVIORAL_HEALTH_DOCUMENTATION');
  const medical = enabled.has('MEDICAL_DOCUMENTATION');
  const medicalOnly = medical && !behavioral;
  const canCapture = enabled.has('AMBIENT_CAPTURE') || enabled.has('LIVE_ENCOUNTER');

  const patientHref = '/app/patients';
  const encounterHref = medicalOnly
    ? '/app/patients'
    : canCapture
      ? '/app/encounters/new'
      : '/app/today';

  const items: OrbitNavItem[] = [
    { id: 'today', href: '/app/today', label: 'Today', icon: 'today', mobile: true },
    { id: 'patients', href: patientHref, label: 'Patients', icon: 'clients', mobile: true },
    {
      id: 'encounters',
      href: encounterHref,
      label: 'Encounters',
      icon: 'record',
      mobile: true,
    },
    {
      id: 'assistant',
      href: '/app/practice-assistant',
      label: 'ORBIT Assistant',
      icon: 'assistant',
      mobile: true,
    },
    {
      id: 'analytics',
      href: '/app/dashboard',
      label: 'Analytics',
      icon: 'dashboard',
      mobile: true,
    },
  ];

  if (behavioral) {
    items.push({
      id: 'templates',
      href: '/app/templates',
      label: 'Templates',
      icon: 'templates',
      mobile: false,
    });
  }
  items.push({ id: 'learn', href: '/app/learn', label: 'Learn', icon: 'learn', mobile: false });
  return { items, newEncounterHref: encounterHref };
}

export function isOrbitNavItemActive(path: string, item: OrbitNavItem): boolean {
  if (item.id === 'encounters') {
    return path.startsWith('/app/encounters') || path.startsWith('/app/sessions');
  }
  return path === item.href || path.startsWith(`${item.href}/`);
}
