import { describe, expect, it } from 'vitest';
import {
  assignmentDueAtMatches,
  isActiveShareSubmission,
  isDeliveredShareStatus,
  homeworkShareSessionMatches,
  isUsableResendAncestorStatus,
  linkHomeworkAssignments,
  recoverExpiredDispatch,
  validateOptionalShareSession,
} from './sprint5-final-behavior';

describe('Sprint 5 final behavioral blockers', () => {
  it('does not classify real provider failure statuses as delivered', () => {
    expect(isDeliveredShareStatus('SENT')).toBe(true);
    expect(isDeliveredShareStatus('OPENED')).toBe(true);
    expect(isDeliveredShareStatus('TRANSIENT_FAILURE')).toBe(false);
    expect(isDeliveredShareStatus('PERMANENT_FAILURE')).toBe(false);
  });

  it('never retries an expired started provider delivery without verified idempotency', () => {
    expect(recoverExpiredDispatch({ dispatchStartedAt: new Date(), channel: 'EMAIL' })).toEqual({
      retry: false,
      status: 'TRANSIENT_FAILURE',
      errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
    });
    expect(recoverExpiredDispatch({ dispatchStartedAt: null, channel: 'EMAIL' }).retry).toBe(true);
  });

  it('blocks withdrawal only while a started dispatch lease is still active', () => {
    const now = new Date('2026-09-02T04:00:00.000Z');
    expect(
      isActiveShareSubmission(
        {
          dispatchStartedAt: new Date('2026-09-02T03:59:00.000Z'),
          dispatchLeaseExpiresAt: new Date('2026-09-02T04:04:00.000Z'),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isActiveShareSubmission(
        {
          dispatchStartedAt: new Date('2026-09-02T03:50:00.000Z'),
          dispatchLeaseExpiresAt: new Date('2026-09-02T03:55:00.000Z'),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isActiveShareSubmission(
        { dispatchStartedAt: new Date('2026-09-02T03:50:00.000Z'), dispatchLeaseExpiresAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('allows a delivered resend through failed ancestry but rejects pending or revoked ancestry', () => {
    expect(isUsableResendAncestorStatus('SENT')).toBe(true);
    expect(isUsableResendAncestorStatus('OPENED')).toBe(true);
    expect(isUsableResendAncestorStatus('TRANSIENT_FAILURE')).toBe(true);
    expect(isUsableResendAncestorStatus('PERMANENT_FAILURE')).toBe(true);
    expect(isUsableResendAncestorStatus('PENDING')).toBe(false);
    expect(isUsableResendAncestorStatus('REVOKED')).toBe(false);
  });

  it('validates an optional association session against both owners', () => {
    expect(validateOptionalShareSession(undefined, undefined, 'client-1', 'psy-1')).toBe(true);
    expect(
      validateOptionalShareSession(
        'session-1',
        { id: 'session-1', clientId: 'client-1', psychologistId: 'psy-1' },
        'client-1',
        'psy-1',
      ),
    ).toBe(true);
    expect(
      validateOptionalShareSession(
        'session-1',
        { id: 'session-1', clientId: 'client-2', psychologistId: 'psy-1' },
        'client-1',
        'psy-1',
      ),
    ).toBe(false);
  });

  it('requires HOMEWORK session provenance to exactly match the assignment source', () => {
    expect(homeworkShareSessionMatches(undefined, null)).toBe(true);
    expect(homeworkShareSessionMatches('fabricated-session', null)).toBe(false);
    expect(homeworkShareSessionMatches('session-1', 'session-1')).toBe(true);
    expect(homeworkShareSessionMatches('session-2', 'session-1')).toBe(false);
    expect(homeworkShareSessionMatches(undefined, 'session-1')).toBe(true);
  });

  it('normalizes absent assignment due dates to null on replay', () => {
    expect(assignmentDueAtMatches(null, null)).toBe(true);
    expect(
      assignmentDueAtMatches(new Date('2026-09-01T00:00:00Z'), '2026-09-01T00:00:00.000Z'),
    ).toBe(true);
  });

  it('links explicit homework assignments only to their delivered HOMEWORK share', () => {
    const assignments = [{ id: 'a1', title: 'Practice', href: null }];
    const shares = [
      { artefactType: 'HOMEWORK', artefactId: 'a1', status: 'SENT', href: '/p/token' },
      { artefactType: 'HOMEWORK', artefactId: 'a1', status: 'PERMANENT_FAILURE', href: '/p/bad' },
    ];
    expect(linkHomeworkAssignments(assignments, shares)).toEqual([
      { id: 'a1', title: 'Practice', href: '/p/token' },
    ]);
  });
});
