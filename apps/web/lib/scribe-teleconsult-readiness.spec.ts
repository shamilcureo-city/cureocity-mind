import { describe, expect, it } from 'vitest';
import { teleconsultCaptureBlock, teleconsultConsentLabel } from './scribe-teleconsult-readiness';

const now = Date.parse('2026-09-26T12:00:00Z');
const ready = {
  configured: true,
  record: { status: 'open', expiresAt: '2026-09-26T13:00:00Z', patientConsent: 'granted' },
  checkedAt: now,
  now,
  doctorConfirmed: true,
  audioReady: true,
};
describe('Scribe teleconsult capture readiness', () => {
  it('permits capture only with all independent prerequisites', () =>
    expect(teleconsultCaptureBlock(ready)).toBeNull());
  it.each([
    { configured: false },
    { record: null },
    { checkedAt: 0 },
    { checkedAt: now - 6_001 },
    { doctorConfirmed: false },
    { audioReady: false },
  ])('blocks when prerequisite is absent: %j', (change) =>
    expect(teleconsultCaptureBlock({ ...ready, ...change })).toBeTruthy(),
  );
  it.each(['pending', 'declined', 'withdrawn'])(
    'does not treat %s patient consent as permission',
    (patientConsent) => {
      expect(
        teleconsultCaptureBlock({ ...ready, record: { ...ready.record, patientConsent } }),
      ).toBeTruthy();
    },
  );
  it.each(['revoked', 'ended', 'expired'])('blocks %s invitations', (status) => {
    expect(teleconsultCaptureBlock({ ...ready, record: { ...ready.record, status } })).toContain(
      'closed',
    );
  });
  it.each(['2026-09-26T12:00:00Z', 'invalid'])(
    'fails closed for invalid/past expiration %s',
    (expiresAt) => {
      expect(
        teleconsultCaptureBlock({ ...ready, record: { ...ready.record, expiresAt } }),
      ).toContain('expired');
    },
  );
  it('shows audio failure without suggesting silent microphone fallback', () => {
    expect(
      teleconsultCaptureBlock({ ...ready, audioReady: false, audioError: 'Patient disconnected' }),
    ).toBe('Patient disconnected');
  });
  it('labels consent without describing call participation as consent', () => {
    expect(teleconsultConsentLabel(undefined)).toBe('Awaiting patient choice');
    expect(teleconsultConsentLabel('withdrawn')).toBe('Patient withdrew consent');
  });
});
