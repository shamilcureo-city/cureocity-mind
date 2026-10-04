import { describe, expect, it } from 'vitest';
import {
  defaultReceptionSettings,
  type ReceptionAction,
  type ReceptionRequestView,
  type ReceptionWorkspace,
} from './reception';
import {
  parseReceptionActionReceipt,
  reconcileReceptionReceipt,
} from './reception-workspace-state';

const request = (overrides: Partial<ReceptionRequestView> = {}): ReceptionRequestView => ({
  id: 'request-one',
  kind: 'BOOKING',
  status: 'NEW',
  patientName: 'Fictional Patient',
  patientPhone: '+971501234567',
  patientEmail: null,
  message: '',
  desiredStartAt: '2026-10-02T10:00:00+04:00',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-01T08:00:00Z',
  appointmentId: null,
  sessionId: null,
  clientId: null,
  events: [],
  ...overrides,
});

const approval: ReceptionAction = {
  action: 'APPROVE_BOOKING',
  clientId: 'client-one',
  identityVerified: true,
};
const erase: ReceptionAction = { action: 'ERASE', confirmErase: true };
const booked = (overrides: Partial<ReceptionRequestView> = {}) =>
  request({
    status: 'BOOKED',
    appointmentId: 'appointment-one',
    sessionId: 'session-one',
    clientId: 'client-one',
    updatedAt: '2026-10-01T08:10:00Z',
    events: [{ id: 'event-one', action: 'BOOKING_APPROVED', createdAt: '2026-10-01T08:10:00Z' }],
    ...overrides,
  });

describe('reception action receipts', () => {
  it('accepts a booked receipt for the requested record and explicitly selected client', () => {
    const receipt = booked();
    expect(parseReceptionActionReceipt('request-one', approval, receipt)).toEqual(receipt);
  });

  it.each([
    ['wrong request', { id: 'request-two' }],
    ['wrong request kind', { kind: 'QUESTION' }],
    ['unreviewed status', { status: 'NEW' }],
    ['wrong final status', { status: 'DECLINED' }],
    ['different client', { clientId: 'client-two' }],
    ['missing client link', { clientId: null }],
    ['missing appointment link', { appointmentId: null }],
    ['empty appointment link', { appointmentId: '' }],
    ['missing session link', { sessionId: null }],
    ['empty session link', { sessionId: '' }],
  ] as const)('rejects approval with %s', (_label, change) => {
    expect(() => parseReceptionActionReceipt('request-one', approval, booked(change))).toThrow(
      'could not be verified',
    );
  });

  it.each([null, undefined, true, 'saved', [], {}, { status: 'BOOKED' }])(
    'rejects malformed response %j instead of treating HTTP success as confirmation',
    (body) => {
      expect(() => parseReceptionActionReceipt('request-one', approval, body)).toThrow(
        'could not be verified',
      );
    },
  );

  it.each([
    { createdAt: 'yesterday' },
    { updatedAt: 'not-a-date' },
    { desiredStartAt: 'morning' },
    { events: undefined },
    { events: [{ id: 'event-one', action: 'BOOKING_APPROVED', createdAt: 'invalid' }] },
    { patientPhone: 123456 },
    { appointmentId: true },
  ])('rejects malformed receipt fields %j', (change) => {
    expect(() =>
      parseReceptionActionReceipt('request-one', approval, { ...booked(), ...change }),
    ).toThrow();
  });

  it.each([
    ['DECLINE', 'DECLINED'],
    ['RESOLVE', 'RESOLVED'],
  ] as const)('requires the matching terminal status for %s', (action, status) => {
    const receipt = request({ kind: 'QUESTION', status });
    expect(parseReceptionActionReceipt('request-one', { action }, receipt)).toEqual(receipt);
    expect(() => parseReceptionActionReceipt('request-one', { action }, request())).toThrow();
    expect(() => parseReceptionActionReceipt('request-one', { action }, booked())).toThrow();
  });

  it('accepts only the explicit erasure acknowledgement', () => {
    expect(parseReceptionActionReceipt('request-one', erase, { erased: true })).toEqual({
      erased: true,
    });
  });

  it.each([
    null,
    undefined,
    true,
    {},
    [],
    { erased: false },
    { erased: 'true' },
    { erased: 1 },
    { erased: true, id: 'request-one' },
    { erased: true, unexpected: 'extra data' },
  ])('rejects incomplete, coercible or extra-field erasure response %j', (body) => {
    expect(() => parseReceptionActionReceipt('request-one', erase, body)).toThrow();
  });
});

describe('immediate reception receipt reconciliation', () => {
  function workspace(): ReceptionWorkspace {
    return {
      settings: defaultReceptionSettings('Fictional clinic'),
      practitionerName: 'Fictional Doctor',
      vertical: 'DOCTOR',
      requests: [request(), request({ id: 'request-two', patientName: 'Other Fictional Patient' })],
      clients: [{ id: 'client-one', name: 'Fictional Patient' }],
    };
  }

  it('replaces only the intended request immediately without waiting for a refreshed workspace', () => {
    const before = workspace();
    const receipt = booked();
    const after = reconcileReceptionReceipt(before, 'request-one', receipt);
    expect(after.requests[0]).toBe(receipt);
    expect(after.requests[1]).toBe(before.requests[1]);
    expect(after.requests).toHaveLength(2);
    expect(before.requests[0].status).toBe('NEW');
    expect(after).not.toBe(before);
    expect(after.settings).toBe(before.settings);
    expect(after.clients).toBe(before.clients);
    expect(after.practitionerName).toBe(before.practitionerName);
    expect(after.vertical).toBe(before.vertical);
  });

  it('removes only the erased enquiry, not client records or unrelated requests', () => {
    const before = workspace();
    const after = reconcileReceptionReceipt(before, 'request-one', { erased: true });
    expect(after.requests).toEqual([before.requests[1]]);
    expect(after.requests[0]).toBe(before.requests[1]);
    expect(before.requests).toHaveLength(2);
    expect(after.settings).toBe(before.settings);
    expect(after.clients).toBe(before.clients);
  });

  it('does not append or remove anything when the acted-on enquiry is no longer in the inbox', () => {
    const before = workspace();
    const approved = reconcileReceptionReceipt(
      before,
      'no-longer-listed',
      booked({ id: 'no-longer-listed' }),
    );
    const erased = reconcileReceptionReceipt(before, 'no-longer-listed', { erased: true });
    expect(approved.requests).toEqual(before.requests);
    expect(erased.requests).toEqual(before.requests);
    expect(approved.clients).toBe(before.clients);
    expect(erased.clients).toBe(before.clients);
  });

  it.each(['BOOKED', 'DECLINED', 'RESOLVED'] as const)(
    'updates the total pending count after a confirmed %s receipt before refresh',
    (status) => {
      const before = { ...workspace(), pendingCount: 205, hasMoreHistory: true };
      const receipt = request({ status });
      const after = reconcileReceptionReceipt(before, 'request-one', receipt);
      expect(after.pendingCount).toBe(204);
      expect(after.hasMoreHistory).toBe(true);
      expect(before.pendingCount).toBe(205);
      expect(reconcileReceptionReceipt(after, 'request-one', receipt).pendingCount).toBe(204);
    },
  );

  it('decrements the total for erased pending work and never decrements twice', () => {
    const before = { ...workspace(), pendingCount: 205 };
    const after = reconcileReceptionReceipt(before, 'request-one', { erased: true });
    expect(after.pendingCount).toBe(204);
    expect(reconcileReceptionReceipt(after, 'request-one', { erased: true }).pendingCount).toBe(
      204,
    );
  });

  it('does not decrement the pending count when deleting history or an unknown request', () => {
    const before = { ...workspace(), pendingCount: 205, requests: [booked()] };
    expect(reconcileReceptionReceipt(before, 'request-one', { erased: true }).pendingCount).toBe(
      205,
    );
    expect(reconcileReceptionReceipt(before, 'not-loaded', { erased: true }).pendingCount).toBe(
      205,
    );
    expect(
      reconcileReceptionReceipt(before, 'not-loaded', booked({ id: 'not-loaded' })).pendingCount,
    ).toBe(205);
  });

  it('keeps fixture count fallback intact and never makes an explicit count negative', () => {
    expect(
      reconcileReceptionReceipt(workspace(), 'request-one', booked()).pendingCount,
    ).toBeUndefined();
    expect(
      reconcileReceptionReceipt({ ...workspace(), pendingCount: 0 }, 'request-one', booked())
        .pendingCount,
    ).toBe(0);
  });
});
