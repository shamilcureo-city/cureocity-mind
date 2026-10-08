/** Capture-specific evidence is additive to the existing scope/standing-consent gates. */
export type ScribeConsentMode = 'LIVE' | 'DICTATE' | 'UPLOAD';

export function scribeConsentMode(snapshot: unknown): ScribeConsentMode | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const mode = (snapshot as { captureMode?: unknown }).captureMode;
  return mode === 'LIVE' || mode === 'DICTATE' || mode === 'UPLOAD' ? mode : null;
}

export function scribeAmbientCaptureDeclined(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const value = snapshot as { ambientCaptureDeclined?: unknown; notes?: unknown };
  return (
    value.ambientCaptureDeclined === true ||
    (typeof value.notes === 'string' &&
      value.notes.includes('Patient declined live ambient capture for this encounter.'))
  );
}

export function scribeConsentAllowsMode(snapshot: unknown, mode: ScribeConsentMode): boolean {
  const recordedMode = scribeConsentMode(snapshot);
  if (recordedMode && recordedMode !== mode) return false;
  return mode !== 'LIVE' || !scribeAmbientCaptureDeclined(snapshot);
}
