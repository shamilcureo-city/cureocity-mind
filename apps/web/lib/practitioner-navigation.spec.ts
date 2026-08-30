import { describe, expect, it } from 'vitest';
import { practitionerNavigation } from './practitioner-navigation';

describe('practitioner navigation', () => {
  it('returns Mind vocabulary and never exposes Scribe routes for therapists', () => {
    const desktop = practitionerNavigation('THERAPIST', 'desktop');
    const mobile = practitionerNavigation('THERAPIST', 'mobile');

    expect(desktop.primary.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/app/today', label: 'Today' },
      { href: '/app/encounters/new', label: 'Start session' },
      { href: '/app/clients', label: 'Clients' },
      { href: '/app/search', label: 'Search' },
      { href: '/app/templates', label: 'Templates' },
      { href: '/app/learn', label: 'Learn' },
    ]);
    expect(mobile.primary.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/app/today', label: 'Today' },
      { href: '/app/encounters/new', label: 'Session' },
      { href: '/app/clients', label: 'Clients' },
      { href: '/app/search', label: 'Search' },
    ]);
    expect([
      ...desktop.primary,
      ...desktop.secondary,
      ...mobile.primary,
      ...mobile.secondary,
    ]).not.toEqual(expect.arrayContaining([expect.objectContaining({ href: '/app/patients' })]));
  });

  it('returns Scribe vocabulary and never exposes Mind routes for doctors', () => {
    const desktop = practitionerNavigation('DOCTOR', 'desktop');
    const mobile = practitionerNavigation('DOCTOR', 'mobile');

    expect(desktop.primary.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/app/clinic', label: 'Clinic' },
      { href: '/app/patients', label: 'Patients' },
      { href: '/app/insights', label: 'Insights' },
      { href: '/app/learn', label: 'Learn' },
    ]);
    expect(mobile.primary.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/app/clinic', label: 'Clinic' },
      { href: '/app/patients', label: 'Patients' },
      { href: '/app/insights', label: 'Insights' },
      { href: '/app/settings', label: 'Settings' },
    ]);
    expect(desktop.secondary).toEqual([]);
    expect(mobile.secondary).toEqual([]);
    expect([...desktop.primary, ...mobile.primary]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ href: '/app/clients' })]),
    );
  });
});
