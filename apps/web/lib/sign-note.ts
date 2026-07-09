'use client';

import { authenticateWithChallenge } from '@/lib/webauthn';

/**
 * Sprint TS0 (F6) — note sign-off with WebAuthn step-up.
 *
 * The sign route (`app/api/v1/sessions/[id]/sign/route.ts`) returns 401 on an
 * assertion-free attempt IFF the account has a registered passkey. The
 * previous client code (both `NotesTab` and `ReviewAndSign`) never collected
 * an assertion, so a therapist/doctor who HAD enrolled a passkey could not
 * sign — the request 401'd and surfaced a raw error.
 *
 * This helper posts the sign request without an assertion first (unchanged
 * happy path for accounts with no passkey), and ONLY on a 401 runs the
 * WebAuthn ceremony bound to the same payload hash, then retries once. A 401
 * on the assertion-free attempt unambiguously means "a credential is
 * registered — assert" (it is the sole first-attempt 401 the route emits), so
 * this never triggers for no-passkey accounts and cannot regress them.
 */
export interface SignNoteBody {
  /** The exact JSON string the server SHA-256s to verify (+ bind the assertion). */
  payload: string;
  payloadHashHex: string;
  /** The note content (TherapyNoteV1 | IntakeNoteV1 | MedicalEncounterNoteV1). */
  note: unknown;
  edits: unknown[];
  signedAt: string;
}

async function postOnce(sessionId: string, body: unknown): Promise<Response> {
  return fetch(`/api/v1/sessions/${sessionId}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postSignNote(sessionId: string, body: SignNoteBody): Promise<Response> {
  const first = await postOnce(sessionId, body);
  if (first.status !== 401) return first;
  // A registered passkey exists — run the biometric ceremony, binding the
  // SAME payload the server will re-hash, then retry exactly once.
  const assertion = await authenticateWithChallenge(body.payload);
  return postOnce(sessionId, { ...body, assertion });
}
