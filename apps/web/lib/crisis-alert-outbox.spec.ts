import { describe, expect, it, vi } from 'vitest';
import { processCrisisAlertOutbox, type CrisisOutboxDeps } from './crisis-alert-outbox';

describe('recoverable crisis alert outbox', () => {
  it('terminalizes stale submission-started as UNKNOWN without provider retry', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const audit = vi.fn();
    const send = vi.fn();
    const result = await processCrisisAlertOutbox({
      now: new Date('2026-09-01T12:00:00Z'),
      staleAfterMs: 60_000,
      deps: {
        listStaleStarted: vi.fn().mockResolvedValue([
          {
            id: 'a1',
            clientId: 'c1',
            psychologistId: 'p1',
            submissionStartedAt: new Date('2026-09-01T11:00:00Z'),
          },
        ]),
        terminalizeUnknown: updateMany,
        listPending: vi.fn().mockResolvedValue([]),
        claimPending: vi.fn(),
        failPending: vi.fn(),
        markSubmissionStarted: vi.fn(),
        finalize: vi.fn(),
        audit,
        loadRecipient: vi.fn(),
        send,
      },
    });
    expect(updateMany).toHaveBeenCalledWith('a1', expect.any(Date));
    expect(send).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'unknown' }));
    expect(result.unknown).toBe(1);
    expect(result.failures).toEqual(['a1']);
  });

  it('claims unclaimed PENDING work and uses the attempt id as stable provider idempotency', async () => {
    const send = vi.fn().mockResolvedValue({ outcome: 'sent', providerMessageId: 'm1' });
    const finalize = vi.fn().mockResolvedValue(true);
    await processCrisisAlertOutbox({
      now: new Date('2026-09-01T12:00:00Z'),
      deps: {
        listStaleStarted: vi.fn().mockResolvedValue([]),
        terminalizeUnknown: vi.fn(),
        listPending: vi.fn().mockResolvedValue([{ id: 'a1' }]),
        claimPending: vi.fn().mockResolvedValue(true),
        failPending: vi.fn().mockResolvedValue(true),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        finalize,
        audit: vi.fn(),
        loadRecipient: vi.fn().mockResolvedValue({
          to: 't@example.test',
          therapistName: 'T',
          clientRecordUrl: 'https://example.test/app/clients/c1',
        }),
        send,
      },
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'a1' }));
    expect(finalize).toHaveBeenCalledWith(
      'a1',
      expect.any(String),
      expect.objectContaining({ status: 'SENT' }),
    );
  });

  it('maps an explicit permanent provider failure to FAILED with audit and failure visibility', async () => {
    const finalize = vi.fn().mockResolvedValue(true);
    const audit = vi.fn();
    const result = await processCrisisAlertOutbox({
      now: new Date('2026-09-01T12:00:00Z'),
      deps: {
        listStaleStarted: vi.fn().mockResolvedValue([]),
        terminalizeUnknown: vi.fn(),
        listPending: vi.fn().mockResolvedValue([{ id: 'a-permanent' }]),
        claimPending: vi.fn().mockResolvedValue(true),
        failPending: vi.fn().mockResolvedValue(true),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        loadRecipient: vi.fn().mockResolvedValue({
          to: 't@example.test',
          therapistName: 'T',
          clientRecordUrl: 'https://example.test/app/clients/c1',
        }),
        send: vi.fn().mockResolvedValue({
          outcome: 'permanent_failure',
          errorCode: 'SENDGRID_400',
        }),
        finalize,
        audit,
      },
    });

    expect(finalize).toHaveBeenCalledWith(
      'a-permanent',
      expect.any(String),
      expect.objectContaining({ status: 'FAILED', errorCode: 'SENDGRID_400' }),
    );
    expect(audit).toHaveBeenCalledWith({
      id: 'a-permanent',
      outcome: 'failed',
      errorCode: 'SENDGRID_400',
    });
    expect(result).toEqual({
      sent: 0,
      failed: 1,
      unknown: 0,
      failures: ['a-permanent'],
    });
  });

  it('keeps a true transient provider outcome UNKNOWN for manual reconciliation', async () => {
    const finalize = vi.fn().mockResolvedValue(true);
    const audit = vi.fn();
    const result = await processCrisisAlertOutbox({
      deps: {
        listStaleStarted: vi.fn().mockResolvedValue([]),
        terminalizeUnknown: vi.fn(),
        listPending: vi.fn().mockResolvedValue([{ id: 'a-ambiguous' }]),
        claimPending: vi.fn().mockResolvedValue(true),
        failPending: vi.fn().mockResolvedValue(true),
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        loadRecipient: vi.fn().mockResolvedValue({
          to: 't@example.test',
          therapistName: 'T',
          clientRecordUrl: 'https://example.test/app/clients/c1',
        }),
        send: vi.fn().mockResolvedValue({
          outcome: 'transient_failure',
          errorCode: 'SENDGRID_NETWORK',
        }),
        finalize,
        audit,
      },
    });

    expect(finalize).toHaveBeenCalledWith(
      'a-ambiguous',
      expect.any(String),
      expect.objectContaining({ status: 'UNKNOWN', errorCode: 'SENDGRID_NETWORK' }),
    );
    expect(audit).toHaveBeenCalledWith({
      id: 'a-ambiguous',
      outcome: 'unknown',
      errorCode: 'SENDGRID_NETWORK',
    });
    expect(result).toEqual({ sent: 0, failed: 0, unknown: 1, failures: ['a-ambiguous'] });
  });

  it('terminalizes a missing recipient from PENDING without crossing the provider boundary', async () => {
    const failPending = vi.fn().mockResolvedValue(true);
    const finalize = vi.fn();
    const markSubmissionStarted = vi.fn();
    const send = vi.fn();
    const audit = vi.fn();
    const deps = {
      listStaleStarted: vi.fn().mockResolvedValue([]),
      terminalizeUnknown: vi.fn(),
      listPending: vi.fn().mockResolvedValue([{ id: 'a-no-recipient' }]),
      claimPending: vi.fn().mockResolvedValue(true),
      markSubmissionStarted,
      loadRecipient: vi.fn().mockResolvedValue(null),
      send,
      failPending,
      finalize,
      audit,
    } as unknown as CrisisOutboxDeps;

    const result = await processCrisisAlertOutbox({ deps });

    expect(failPending).toHaveBeenCalledWith(
      'a-no-recipient',
      expect.any(String),
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'RECIPIENT_UNAVAILABLE',
      }),
    );
    expect(finalize).not.toHaveBeenCalled();
    expect(markSubmissionStarted).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      id: 'a-no-recipient',
      outcome: 'failed',
      errorCode: 'RECIPIENT_UNAVAILABLE',
    });
    expect(result).toEqual({ sent: 0, failed: 1, unknown: 0, failures: ['a-no-recipient'] });
  });
});
