import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let finishProvider!: (value: { outcome: 'sent'; providerMessageId: string }) => void;
  return {
    sendViaChannel: vi.fn(),
    writeAudit: vi.fn(),
    finishProvider: (value: { outcome: 'sent'; providerMessageId: string }) =>
      finishProvider(value),
    resetProvider: () =>
      new Promise<{ outcome: 'sent'; providerMessageId: string }>((resolve) => {
        finishProvider = resolve;
      }),
    descendant: null as Record<string, unknown> | null,
  };
});

vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () => ({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  })),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://example.test') }));
vi.mock('./share-channels', () => ({
  shareChannels: vi.fn(() => ({ whatsappReady: true, emailReady: true })),
}));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(async () => ({
    destination: 'patient@example.test',
    clientFirstName: 'Patient',
  })),
}));
vi.mock('./tenant-crypto', () => ({
  decryptForTenant: vi.fn(async () => JSON.stringify({ version: 1, value: 'Frozen message' })),
}));
vi.mock('./sprint5-final-behavior', () => ({
  activeShareSubmissionWhere: vi.fn(() => ({
    status: 'PENDING',
    dispatchStartedAt: { not: null },
    dispatchLeaseExpiresAt: { gt: expect.any(Date) },
  })),
  canOrdinarilyResend: vi.fn(() => false),
  recoverExpiredDispatch: vi.fn(),
  classifyShareDelivery: vi.fn(() => ({ status: 'SENT', errorCode: null })),
}));
vi.mock('../app/api/v1/share/route', () => ({ sendViaChannel: mocks.sendViaChannel }));
vi.mock('./prisma', () => {
  const root = {
    id: 'share-root',
    psychologistId: 'psy-1',
    clientId: 'client-1',
    sessionId: 'session-1',
    shareBatchId: 'batch-1',
    status: 'SENT',
    errorCode: null,
    channel: 'EMAIL',
    artefactType: 'AFTER_VISIT_SUMMARY',
    artefactId: 'session-1',
    language: 'en',
    snapshot: { kind: 'AFTER_VISIT_SUMMARY' },
    subject: 'Visit summary',
    shareToken: 'root-token',
    recipientEnvelopeEncrypted: 'recipient-ciphertext',
    therapistMessageEncrypted: 'message-ciphertext',
    refreshRequestedAt: new Date(),
    expiresAt: new Date(0),
    client: { id: 'client-1', deletedAt: null },
  };
  const patientShare = {
    findFirst: vi.fn(async () => root),
    findUnique: vi.fn(async (args: { where: Record<string, unknown> }) => {
      if ('resendOfId' in args.where) return null;
      return root;
    }),
    findMany: vi.fn(async () => (mocks.descendant ? [{ id: mocks.descendant.id }] : [])),
    count: vi.fn(async () => 0),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      mocks.descendant = { ...data, id: 'share-resend', status: 'PENDING' };
      return mocks.descendant;
    }),
    update: vi.fn(),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (where.id === 'share-resend' && mocks.descendant) Object.assign(mocks.descendant, data);
        return { count: 1 };
      },
    ),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    patientShare,
    shareRateReservation: { findMany: vi.fn(async () => []) },
  };
  return {
    prisma: {
      patientShare,
      $transaction: vi.fn(async (fn: (transaction: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { POST as resend } from '../app/api/v1/shares/[id]/resend/route';
import { POST as revoke } from '../app/api/v1/shares/[id]/revoke/route';

describe('share withdrawal concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.descendant = null;
    mocks.sendViaChannel.mockImplementation(() => mocks.resetProvider());
  });

  it('does not report revoke complete while a resend provider submission is in flight', async () => {
    const resendRequest = resend(
      new Request('https://example.test/api/v1/shares/share-root/resend', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'share-root' }) },
    );
    await vi.waitFor(() => expect(mocks.sendViaChannel).toHaveBeenCalledTimes(1));

    const revokeResponse = await revoke(
      new Request('https://example.test/api/v1/shares/share-root/revoke', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'share-root' }) },
    );

    expect(revokeResponse.status).toBe(409);
    expect(await revokeResponse.json()).toEqual({
      error: 'Share withdrawal is blocked while provider submission is in progress.',
    });

    mocks.finishProvider({ outcome: 'sent', providerMessageId: 'provider-1' });
    await resendRequest;
  });
});
