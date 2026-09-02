export type DeliveredStatus =
  | 'PENDING'
  | 'SENT'
  | 'OPENED'
  | 'TRANSIENT_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'REVOKED';

export function isDeliveredShareStatus(status: DeliveredStatus | string): boolean {
  return status === 'SENT' || status === 'OPENED';
}

export function isActiveShareSubmission(
  row: { dispatchStartedAt: Date | null; dispatchLeaseExpiresAt: Date | null },
  now = new Date(),
): boolean {
  return (
    !!row.dispatchStartedAt && !!row.dispatchLeaseExpiresAt && row.dispatchLeaseExpiresAt > now
  );
}

export function activeShareSubmissionWhere(now = new Date()) {
  return {
    status: 'PENDING' as const,
    dispatchStartedAt: { not: null },
    dispatchLeaseExpiresAt: { gt: now },
  };
}

export function isUsableResendAncestorStatus(status: DeliveredStatus | string): boolean {
  return status !== 'PENDING' && status !== 'REVOKED';
}

export function recoverExpiredDispatch(row: {
  dispatchStartedAt: Date | null;
  channel: string;
}):
  | { retry: true }
  | { retry: false; status: 'TRANSIENT_FAILURE'; errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED' } {
  if (!row.dispatchStartedAt || row.channel === 'PORTAL_LINK') return { retry: true };
  return {
    retry: false,
    status: 'TRANSIENT_FAILURE',
    errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
  };
}

export function validateOptionalShareSession(
  requestedId: string | undefined,
  session: { id: string; clientId: string; psychologistId: string } | undefined,
  clientId: string,
  psychologistId: string,
): boolean {
  return (
    requestedId === undefined ||
    (!!session &&
      session.id === requestedId &&
      session.clientId === clientId &&
      session.psychologistId === psychologistId)
  );
}

export function homeworkShareSessionMatches(
  requestedSessionId: string | undefined,
  assignmentSourceSessionId: string | null,
): boolean {
  return requestedSessionId === undefined || requestedSessionId === assignmentSourceSessionId;
}

export function assignmentDueAtMatches(
  existing: Date | null,
  requestedIso: string | null,
): boolean {
  return (existing?.toISOString() ?? null) === requestedIso;
}

const AMBIGUOUS_PROVIDER_CODES = new Set([
  'WATI_NETWORK',
  'SENDGRID_NETWORK',
  'DELIVERY_EXCEPTION',
]);

export function classifyShareDelivery(result: {
  outcome: 'sent' | 'transient_failure' | 'permanent_failure';
  errorCode?: string | null;
}): { status: DeliveredStatus; errorCode: string | null } {
  const code = result.errorCode ?? null;
  const provider5xx = /^(?:WATI|SENDGRID)_5\d\d$/.test(code ?? '');
  if (
    result.outcome === 'transient_failure' &&
    (AMBIGUOUS_PROVIDER_CODES.has(code ?? '') || provider5xx)
  ) {
    return { status: 'TRANSIENT_FAILURE', errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED' };
  }
  return {
    status:
      result.outcome === 'sent'
        ? 'SENT'
        : result.outcome === 'transient_failure'
          ? 'TRANSIENT_FAILURE'
          : 'PERMANENT_FAILURE',
    errorCode: code,
  };
}

export function canOrdinarilyResend(row: {
  status: string;
  errorCode?: string | null;
  verifiedNonDeliveryAt?: Date | null;
}): boolean {
  if (row.errorCode === 'AMBIGUOUS_DELIVERY_NOT_RETRIED' && !row.verifiedNonDeliveryAt)
    return false;
  return row.status.endsWith('FAILURE');
}

export function careHomeShareHref(
  id: string,
  token: string,
  expiresAt: Date,
  now = new Date(),
): string {
  return expiresAt > now ? `/p/${token}` : `/p/home?refresh=${encodeURIComponent(id)}`;
}

export function linkHomeworkAssignments<
  T extends { id: string; href: string | null },
  S extends {
    artefactType: string;
    artefactId: string;
    status: string;
    href: string | null;
    snapshot?: { kind?: string; homeworkAssignmentId?: string | null } | null;
  },
>(assignments: T[], shares: S[]): T[] {
  const delivered = new Map<string, string>();
  for (const share of shares) {
    if (!isDeliveredShareStatus(share.status) || share.href === null) continue;
    const assignmentId =
      share.artefactType === 'HOMEWORK'
        ? share.artefactId
        : share.artefactType === 'THERAPY_SCRIPT' && share.snapshot?.kind === 'THERAPY_SCRIPT'
          ? share.snapshot.homeworkAssignmentId
          : null;
    if (assignmentId && !delivered.has(assignmentId)) delivered.set(assignmentId, share.href);
  }
  return assignments.map((assignment) => ({
    ...assignment,
    href: delivered.get(assignment.id) ?? assignment.href,
  }));
}
