import { describe, expect, it } from 'vitest';
import { buildOrbitNavigation, isOrbitNavItemActive } from './navigation';

describe('ORBIT navigation', () => {
  it('uses one primary information architecture for behavioral and medical users', () => {
    const behavioral = buildOrbitNavigation(['AMBIENT_CAPTURE', 'BEHAVIORAL_HEALTH_DOCUMENTATION']);
    const medical = buildOrbitNavigation(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']);
    expect(behavioral.items.slice(0, 5).map((item) => item.id)).toEqual([
      'today',
      'patients',
      'encounters',
      'assistant',
      'analytics',
    ]);
    expect(medical.items.slice(0, 5).map((item) => item.id)).toEqual(
      behavioral.items.slice(0, 5).map((item) => item.id),
    );
  });

  it('uses the canonical Patients route for every clinical workflow', () => {
    for (const capabilities of [
      ['BEHAVIORAL_HEALTH_DOCUMENTATION'] as const,
      ['MEDICAL_DOCUMENTATION'] as const,
    ]) {
      expect(
        buildOrbitNavigation(capabilities).items.find((item) => item.id === 'patients'),
      ).toMatchObject({ href: '/app/patients', label: 'Patients' });
    }
  });

  it('marks legacy session detail routes as part of Encounters', () => {
    const encounters = buildOrbitNavigation(['AMBIENT_CAPTURE']).items.find(
      (item) => item.id === 'encounters',
    );
    expect(encounters && isOrbitNavItemActive('/app/sessions/session-1', encounters)).toBe(true);
  });
});
