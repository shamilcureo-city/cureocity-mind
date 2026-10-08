import { describe, expect, it } from 'vitest';
import { scribeAmbientCaptureDeclined, scribeConsentAllowsMode } from './scribe-consent-mode';
describe('mode-specific Scribe consent', () => {
  it('preserves a legacy ambient refusal', () => {
    const snapshot = { notes: 'Patient declined live ambient capture for this encounter.' };
    expect(scribeAmbientCaptureDeclined(snapshot)).toBe(true);
    expect(scribeConsentAllowsMode(snapshot, 'LIVE')).toBe(false);
  });
  it('dictation permission cannot authorize ambient capture or upload', () => {
    const snapshot = { captureMode: 'DICTATE', ambientCaptureDeclined: true };
    expect(scribeConsentAllowsMode(snapshot, 'DICTATE')).toBe(true);
    expect(scribeConsentAllowsMode(snapshot, 'LIVE')).toBe(false);
    expect(scribeConsentAllowsMode(snapshot, 'UPLOAD')).toBe(false);
  });
  it('explicit fresh live consent can replace a previous refusal', () => {
    expect(
      scribeConsentAllowsMode({ captureMode: 'LIVE', ambientCaptureDeclined: false }, 'LIVE'),
    ).toBe(true);
  });
  it('does not replace the existing scope gates for legacy snapshots', () => {
    expect(scribeConsentAllowsMode(null, 'LIVE')).toBe(true);
  });
});
