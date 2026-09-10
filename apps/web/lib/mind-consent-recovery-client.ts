import {
  MindConsentRecoveryInputSchema,
  MindConsentRecoveryReceiptSchema,
  MindConsentRecoveryStateSchema,
  type MindConsentRecoveryInput,
} from './mind-consent-recovery';

export class ConsentRecoveryRequestError extends Error {
  constructor(
    message: string,
    readonly needsReload = false,
  ) {
    super(message);
    this.name = 'ConsentRecoveryRequestError';
  }
}

function refusal(status: number): ConsentRecoveryRequestError {
  if (status === 409)
    return new ConsentRecoveryRequestError(
      'The session or consent record changed. Reload the consent details and review them before confirming again.',
      true,
    );
  if (status === 401 || status === 403 || status === 404)
    return new ConsentRecoveryRequestError(
      'This session is not available for consent recovery. Check your access or open the session record. Recording remains off.',
      true,
    );
  return new ConsentRecoveryRequestError(
    'The server could not confirm this request. Recording remains off. Please retry.',
  );
}

/** This client only reads/records consent. It never requests media or starts a session. */
export async function loadConsentRecovery(
  sessionId: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const response = await request(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/consent-recovery`,
    {
      cache: 'no-store',
      signal,
    },
  );
  if (!response.ok) throw refusal(response.status);
  const parsed = MindConsentRecoveryStateSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.sessionId !== sessionId)
    throw new ConsentRecoveryRequestError(
      'The consent details could not be verified. Reload before continuing.',
      true,
    );
  return parsed.data;
}

export async function saveConsentRecovery(
  sessionId: string,
  input: MindConsentRecoveryInput,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const body = MindConsentRecoveryInputSchema.parse(input);
  const response = await request(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/consent-recovery`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!response.ok) throw refusal(response.status);
  const parsed = MindConsentRecoveryReceiptSchema.safeParse(await response.json());
  if (
    !parsed.success ||
    !parsed.data.ready ||
    parsed.data.sessionId !== sessionId ||
    parsed.data.operationId !== input.operationId
  )
    throw new ConsentRecoveryRequestError(
      'The save reply could not be verified. Recording remains off. Retry the same confirmation to check its status.',
    );
  return parsed.data;
}

export function isSessionConsentFailure(status: number, body: unknown): boolean {
  return (
    status === 409 &&
    body !== null &&
    typeof body === 'object' &&
    'code' in body &&
    body.code === 'SESSION_CONSENT_INVALID'
  );
}

export function liveNoteStatus(input: {
  phase: string;
  consentBlocked: boolean;
  refreshing: boolean;
  updatedAgo: number | null;
}): string {
  if (input.consentBlocked) return 'Capture off · consent required';
  if (input.phase === 'idle')
    return input.updatedAgo !== null ? 'Previous draft retained · capture off' : 'Not started';
  if (input.phase === 'error')
    return input.updatedAgo !== null ? 'Draft retained · capture interrupted' : 'Capture off';
  if (['paused', 'pausing', 'pause-unconfirmed'].includes(input.phase)) return 'Capture paused';
  if (input.phase === 'connecting') return 'Connecting · capture not started';
  if (input.phase === 'done') return 'Capture ended';
  if (input.refreshing) return 'Updating…';
  if (input.updatedAgo !== null) return `Updated ${input.updatedAgo}s ago`;
  return input.phase === 'listening' ? 'Waiting for transcribed speech' : 'Preparing draft…';
}
