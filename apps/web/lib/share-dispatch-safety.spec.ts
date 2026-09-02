import { describe, expect, it, vi } from 'vitest';
import { finalizeLeasedShare, readWinningShareDispatch } from './share-dispatch-safety';

describe('share dispatch concurrency safety', () => {
  it('reads dispatch values exclusively from the unique-create winning persisted row', async () => {
    const decryptRecipient = vi.fn().mockResolvedValue({
      destination: 'winner@example.test',
      clientFirstName: 'Winner',
    });
    const decryptMessage = vi.fn().mockResolvedValue({ ok: true, value: 'Winner message' });
    const result = await readWinningShareDispatch(
      {
        psychologistId: 'p1',
        channel: 'EMAIL',
        recipientEnvelopeEncrypted: 'winner-recipient-ciphertext',
        therapistMessageEncrypted: 'winner-message-ciphertext',
        subject: 'Winner subject',
        snapshot: { kind: 'SESSION_TAKEAWAY', summary: 'Winner snapshot' },
        language: 'en',
      },
      { decryptRecipient, decryptMessage },
    );
    expect(decryptRecipient).toHaveBeenCalledWith('p1', 'winner-recipient-ciphertext', 'EMAIL');
    expect(decryptMessage).toHaveBeenCalledWith('p1', 'winner-message-ciphertext');
    expect(result).toMatchObject({
      destination: 'winner@example.test',
      therapistMessage: 'Winner message',
      subject: 'Winner subject',
      snapshot: { summary: 'Winner snapshot' },
    });
  });

  it('prevents late provider completion from overwriting recovered ambiguity or auditing twice', async () => {
    const tx = {
      patientShare: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'share-1',
          status: 'TRANSIENT_FAILURE',
          errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
        }),
      },
    };
    const audit = vi.fn();
    const row = await finalizeLeasedShare(tx as never, {
      rowId: 'share-1',
      leaseOwner: 'late-owner',
      leaseVersion: 1,
      status: 'SENT',
      sentAt: new Date(),
      providerMessageId: 'late-provider-id',
      errorCode: null,
      audit,
    });
    expect(tx.patientShare.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'share-1',
          status: 'PENDING',
          dispatchLeaseOwner: 'late-owner',
          dispatchLeaseVersion: 1,
        }),
      }),
    );
    expect(row.status).toBe('TRANSIENT_FAILURE');
    expect(audit).not.toHaveBeenCalled();
  });
});
