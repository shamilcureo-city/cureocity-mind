/** Browser-side readiness is an extra guard; API authorization remains authoritative. */
export function teleconsultCaptureBlock(input: {
  configured: boolean;
  record: { status: string; expiresAt: string; patientConsent: string } | null;
  checkedAt: number;
  now: number;
  doctorConfirmed: boolean;
  audioReady: boolean;
  audioError?: string | null;
}): string | null {
  if (!input.configured) return 'Video consultations are not configured in this environment.';
  if (!input.record) return 'Create a patient invitation to prepare this consultation.';
  if (input.record.status !== 'open')
    return 'This invitation is closed. AI documentation cannot start.';
  const expiry = Date.parse(input.record.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= input.now) return 'The patient invitation has expired.';
  if (!input.checkedAt || input.now - input.checkedAt > 6_000)
    return 'Consent status could not be confirmed. AI documentation is stopped until it can be checked.';
  if (input.record.patientConsent !== 'granted')
    return input.record.patientConsent === 'pending'
      ? 'Waiting for the patient to choose whether to allow AI documentation. The video call can continue without it.'
      : 'The patient has not agreed to AI documentation. Continue the call without capture.';
  if (!input.doctorConfirmed) return 'Confirm that you explained AI documentation to the patient.';
  if (!input.audioReady)
    return (
      input.audioError ??
      'Join the call and connect both microphones before starting AI documentation.'
    );
  return null;
}

export function teleconsultConsentLabel(consent: string | undefined): string {
  return consent === 'granted'
    ? 'Patient agreed'
    : consent === 'declined'
      ? 'Patient declined'
      : consent === 'withdrawn'
        ? 'Patient withdrew consent'
        : 'Awaiting patient choice';
}
