import { describe, expect, it } from 'vitest';
import { summarizeReminderSendResults } from './appointment-email';

describe('summarizeReminderSendResults', () => {
  it('delivers only when every provider send succeeds', () => {
    expect(
      summarizeReminderSendResults([
        { outcome: 'sent', providerMessageId: 'provider:therapist' },
        { outcome: 'sent', providerMessageId: 'provider:patient' },
      ]),
    ).toEqual({
      outcome: 'sent',
      providerMessageIds: ['provider:therapist', 'provider:patient'],
    });
  });

  it('makes a partial transient failure retryable without retaining provider detail', () => {
    expect(
      summarizeReminderSendResults([
        { outcome: 'sent', providerMessageId: 'provider:therapist' },
        {
          outcome: 'transient_failure',
          errorCode: 'SENDGRID_NETWORK',
          errorDetail: 'patient@example.com socket timeout',
        },
      ]),
    ).toEqual({ outcome: 'transient_failure', errorCode: 'SENDGRID_NETWORK' });
  });

  it('does not retry a permanent provider rejection', () => {
    expect(
      summarizeReminderSendResults([
        { outcome: 'permanent_failure', errorCode: 'SENDGRID_400', errorDetail: 'bad address' },
      ]),
    ).toEqual({ outcome: 'permanent_failure', errorCode: 'SENDGRID_400' });
  });
});
