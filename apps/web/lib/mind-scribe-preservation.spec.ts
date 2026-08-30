import { describe, expect, it } from 'vitest';
import { captureActivationTransitionData } from './session-transition';
import { validateCreateClientForVertical } from './client-draft';
import { mindStartEntryHref } from './mind-session-start';

describe('Mind changes preserve Scribe behavior', () => {
  it('keeps Scribe token-is-start semantics while Mind waits for active capture', () => {
    expect(captureActivationTransitionData('THERAPIST', 'LIVE', false)).toBeNull();
    expect(captureActivationTransitionData('DOCTOR', 'LIVE', false)).toMatchObject({
      status: 'IN_PROGRESS',
      captureMode: 'LIVE',
    });
  });

  it('keeps the doctor patient contract strict while allowing minimal Mind administration', () => {
    const minimal = { fullName: 'Asha', consents: [] };
    expect(validateCreateClientForVertical(minimal, 'THERAPIST')).toBeNull();
    expect(validateCreateClientForVertical(minimal, 'DOCTOR')).toContain('phone number');
  });

  it('does not redirect doctor entry through the Mind recorder', () => {
    expect(
      mindStartEntryHref({
        source: 'CLIENT',
        clientId: 'patient-1',
        captureMode: 'LIVE',
        vertical: 'DOCTOR',
        doctorHref: '/app/patients/patient-1',
      }),
    ).toBe('/app/patients/patient-1');
  });
});
