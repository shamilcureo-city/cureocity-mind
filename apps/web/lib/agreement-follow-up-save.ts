import type { AgreementFollowUp, SessionAgreementDto } from '@cureocity/contracts';

export class AgreementFollowUpConflictError extends Error {}

/** A choice refers to the wording the psychologist actually saw, never a later revision. */
export async function saveAgreementFollowUp(
  agreement: Pick<SessionAgreementDto, 'id' | 'sessionId' | 'revision'>,
  followUp: AgreementFollowUp,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(
    `/api/v1/sessions/${agreement.sessionId}/agreements/${agreement.id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ followUp, expectedRevision: agreement.revision ?? 0 }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 409)
    throw new AgreementFollowUpConflictError(
      'The agreement changed. Reload its latest wording before saving your follow-up.',
    );
  if (!response.ok)
    throw new Error('The follow-up could not be confirmed. Your choice is still here.');
  const receipt = (await response.json().catch(() => null)) as { ok?: unknown } | null;
  if (receipt?.ok !== true)
    throw new Error('The follow-up save returned no confirmation. Your choice is still here.');
}
