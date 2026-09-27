export type ScribeRequestOperation = 'load' | 'create' | 'update';
export type ScribeRequestErrorKind = 'sign-in' | 'inactive' | 'forbidden' | 'conflict' | 'request';

const fallbackMessages: Record<ScribeRequestOperation, string> = {
  load: 'Could not load pending work. Check your connection and try again.',
  create: 'Could not create the task. Check the fields and try again.',
  update: 'Could not update the task. Please try again.',
};

/** Only these locally defined messages are safe to display; never echo a response body. */
export class ScribeRequestError extends Error {
  constructor(
    public readonly kind: ScribeRequestErrorKind,
    message: string,
    public readonly action?: { href: string; label: string },
  ) {
    super(message);
    this.name = 'ScribeRequestError';
  }

  get blocksAccess() {
    return this.kind === 'sign-in' || this.kind === 'inactive' || this.kind === 'forbidden';
  }
}

export function classifyScribeRequestError(
  status: number | null,
  body: unknown,
  operation: ScribeRequestOperation,
): ScribeRequestError {
  if (status === 401) {
    return new ScribeRequestError('sign-in', 'Sign in again to view or update pending work.', {
      href: '/login',
      label: 'Sign in',
    });
  }
  if (status === 403) {
    const details =
      body !== null && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    if (
      details?.code === 'PRACTITIONER_INACTIVE' ||
      (details?.code === undefined && details?.error === 'Practitioner account is not active')
    ) {
      return new ScribeRequestError(
        'inactive',
        'Your practitioner account is not active. Pending work is unavailable until access is restored. Check your account status for the next step.',
        { href: '/account-status', label: 'Check account status' },
      );
    }
    return new ScribeRequestError(
      'forbidden',
      'This account does not have permission to access this pending work. Contact support if you need access.',
      {
        href: 'mailto:shamil@cureo.city?subject=Scribe%20account%20access',
        label: 'Contact support',
      },
    );
  }
  if (status === 409 && operation === 'update') {
    return new ScribeRequestError(
      'conflict',
      'This task changed elsewhere. Review the latest version before trying again.',
    );
  }
  return new ScribeRequestError('request', fallbackMessages[operation]);
}

export async function readScribeRequestError(
  response: Pick<Response, 'status' | 'json'>,
  operation: ScribeRequestOperation,
) {
  // Error payloads are untrusted and may be HTML or malformed JSON.
  const body: unknown = response.status === 403 ? await response.json().catch(() => null) : null;
  return classifyScribeRequestError(response.status, body, operation);
}

export function safeScribeRequestError(reason: unknown, operation: ScribeRequestOperation) {
  return reason instanceof ScribeRequestError
    ? reason
    : classifyScribeRequestError(null, null, operation);
}
