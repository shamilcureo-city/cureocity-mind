'use client';

import { authenticateWithChallenge } from '@/lib/webauthn';
import { canonicalJson, canonicalSigningPayload } from './sign-note-payload';

export interface SignNoteBody {
  note: unknown;
  /** Exact draft body the UI loaded; server rejects it if the locked draft changed. */
  draftContent: unknown;
  edits: unknown[];
  signedAt: string;
  /** Exact confirmed Rx projection, including explicit null. */
  rxPad: unknown | null;
  safetyOverride?: { reason: string; blockers: string[] };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function postOnce(sessionId: string, body: unknown): Promise<Response> {
  return fetch(`/api/v1/sessions/${sessionId}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Build the only accepted payload shape before optionally binding WebAuthn. */
export async function postSignNote(sessionId: string, body: SignNoteBody): Promise<Response> {
  const draftContentHashHex = await sha256Hex(canonicalJson(body.draftContent));
  const payload = canonicalSigningPayload({
    sessionId,
    draftContentHashHex,
    note: body.note,
    edits: body.edits,
    signedAt: body.signedAt,
    safetyOverride: body.safetyOverride,
    rxPad: body.rxPad,
  });
  const payloadHashHex = await sha256Hex(payload);
  const requestBody = {
    payload,
    payloadHashHex,
    note: body.note,
    edits: body.edits,
    signedAt: body.signedAt,
    ...(body.safetyOverride ? { safetyOverride: body.safetyOverride } : {}),
  };
  const first = await postOnce(sessionId, requestBody);
  if (first.status !== 401) return first;
  const assertion = await authenticateWithChallenge(payload);
  return postOnce(sessionId, { ...requestBody, assertion });
}
