import { describe, expect, it } from 'vitest';
import { clientSessionSummary } from './client-session-summary';

describe('Mind client note status truth', () => {
  it('calls only locked, signed notes signed', () => {
    expect(clientSessionSummary('COMPLETED', { locked: true, signedAt: '2026-09-01' }, null)).toBe(
      'Signed note',
    );
    expect(
      clientSessionSummary(
        'COMPLETED',
        { locked: false, signedAt: '2026-09-01' },
        { status: 'COMPLETED' },
      ),
    ).toBe('Reopened — needs signature');
  });
  it('does not equate an in-progress session with an active microphone', () => {
    expect(clientSessionSummary('IN_PROGRESS', null, null)).toBe('Session in progress');
  });
  it('separates unsigned, pending and failed notes from appointments', () => {
    expect(clientSessionSummary('COMPLETED', null, { status: 'COMPLETED' })).toBe('Unsigned draft');
    expect(clientSessionSummary('COMPLETED', null, { status: 'PENDING' })).toBe(
      'Note generation pending',
    );
    expect(clientSessionSummary('COMPLETED', null, { status: 'FAILED' })).toBe(
      'Note generation failed',
    );
    expect(clientSessionSummary('SCHEDULED', null, null)).toBe('Upcoming appointment');
  });
});
