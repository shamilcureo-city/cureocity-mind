import type { PractitionerVertical } from '@cureocity/contracts';

export type PractitionerNavigationSurface = 'desktop' | 'mobile';

export type PractitionerNavIcon =
  | 'dashboard'
  | 'today'
  | 'record'
  | 'clients'
  | 'templates'
  | 'assistant'
  | 'learn'
  | 'me'
  | 'search'
  | 'clinic'
  | 'insights'
  | 'marketing'
  | 'cog';

export interface PractitionerNavItem {
  href: string;
  label: string;
  icon: PractitionerNavIcon;
}

export interface PractitionerNavigation {
  primary: readonly PractitionerNavItem[];
  secondary: readonly PractitionerNavItem[];
}

const THERAPIST_DESKTOP: PractitionerNavigation = {
  primary: [
    { href: '/app/today', label: 'Today', icon: 'today' },
    { href: '/app/encounters/new', label: 'Start session', icon: 'record' },
    { href: '/app/clients', label: 'Clients', icon: 'clients' },
    { href: '/app/search', label: 'Search', icon: 'search' },
  ],
  secondary: [
    { href: '/app/templates', label: 'Note templates', icon: 'templates' },
    { href: '/app/learn', label: 'Learning library', icon: 'learn' },
    { href: '/app/dashboard', label: 'Analytics', icon: 'dashboard' },
    { href: '/app/practice-assistant', label: 'Mind assistant', icon: 'assistant' },
    { href: '/app/me', label: 'My practice', icon: 'me' },
    { href: '/app/marketing', label: 'Marketing', icon: 'marketing' },
  ],
};

const THERAPIST_MOBILE: PractitionerNavigation = {
  primary: [
    { href: '/app/today', label: 'Today', icon: 'today' },
    { href: '/app/encounters/new', label: 'Session', icon: 'record' },
    { href: '/app/clients', label: 'Clients', icon: 'clients' },
    { href: '/app/search', label: 'Search', icon: 'search' },
  ],
  secondary: [
    { href: '/app/templates', label: 'Templates', icon: 'templates' },
    { href: '/app/dashboard', label: 'Analytics', icon: 'dashboard' },
    { href: '/app/practice-assistant', label: 'Mind assistant', icon: 'assistant' },
    { href: '/app/me', label: 'My practice', icon: 'me' },
    { href: '/app/learn', label: 'Learn', icon: 'learn' },
    { href: '/app/marketing', label: 'Marketing', icon: 'marketing' },
    { href: '/app/settings', label: 'Settings', icon: 'cog' },
  ],
};

const DOCTOR_DESKTOP: PractitionerNavigation = {
  primary: [
    { href: '/app/clinic', label: 'Clinic', icon: 'clinic' },
    { href: '/app/patients', label: 'Patients', icon: 'clients' },
    { href: '/app/insights', label: 'Insights', icon: 'insights' },
    { href: '/app/learn', label: 'Learn', icon: 'learn' },
  ],
  secondary: [],
};

const DOCTOR_MOBILE: PractitionerNavigation = {
  primary: [
    { href: '/app/clinic', label: 'Clinic', icon: 'clinic' },
    { href: '/app/patients', label: 'Patients', icon: 'clients' },
    { href: '/app/insights', label: 'Insights', icon: 'insights' },
    { href: '/app/settings', label: 'Settings', icon: 'cog' },
  ],
  secondary: [],
};

/** Return the complete navigation model for one vertical and viewport surface. */
export function practitionerNavigation(
  vertical: PractitionerVertical,
  surface: PractitionerNavigationSurface,
): PractitionerNavigation {
  if (vertical === 'DOCTOR') return surface === 'desktop' ? DOCTOR_DESKTOP : DOCTOR_MOBILE;
  return surface === 'desktop' ? THERAPIST_DESKTOP : THERAPIST_MOBILE;
}
